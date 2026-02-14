import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
    InMemoryStorageAdapter,
    GroupManager,
    createRootIdentity,
    createDeviceIdentity,
    computeBalances,
    orderEntries,
    RelayTransport,
    SyncManager,
    deriveGroupKey,
    parseInviteLink,
    type GroupId,
    type GroupState,
    type LedgerEntry,
    type Ed25519KeyPair,
    type DeviceIdentity,
    type SyncEvent,
    EntryType,
} from '@splitledger/core';

// ─── Types ───

interface IdentityState {
    displayName: string;
    rootKeyPair: Ed25519KeyPair;
    device: DeviceIdentity;
}

interface GroupSummary {
    groupId: GroupId;
    name: string;
    memberCount: number;
    myBalance: number;
    currency: string;
}

type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface AppContextValue {
    // Identity
    identity: IdentityState | null;
    createIdentity: (displayName: string) => void;
    restoreIdentity: (imported: IdentityState) => void;
    isOnboarded: boolean;

    // Group Manager
    manager: GroupManager | null;
    storage: InMemoryStorageAdapter;

    // Groups
    groups: GroupSummary[];
    refreshGroups: () => Promise<void>;

    // Group detail helpers
    getGroupState: (groupId: GroupId) => Promise<GroupState | null>;
    getGroupEntries: (groupId: GroupId) => Promise<LedgerEntry[]>;

    // Sync
    syncStatus: SyncStatus;
    syncGroupFromRelay: (inviteLink: string) => Promise<GroupId>;
    broadcastEntry: (groupId: GroupId, entry: LedgerEntry) => Promise<void>;
}

export type { IdentityState };

const AppContext = createContext<AppContextValue | null>(null);

// ─── Relay URL ───

function getRelayWsUrl(): string {
    // In production (served by nginx), use relative WebSocket URL
    if (import.meta.env.PROD) {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${proto}://${window.location.host}/ws`;
    }
    // In dev, connect directly to relay via Vite proxy
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws`;
}

// ─── LocalStorage persistence helpers ───

const IDENTITY_KEY = 'splitledger-identity';
const GROUPS_KEY = 'splitledger-groups';

function saveIdentityToStorage(identity: IdentityState): void {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

function loadIdentityFromStorage(): IdentityState | null {
    try {
        const raw = localStorage.getItem(IDENTITY_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as IdentityState;
    } catch {
        return null;
    }
}

async function saveGroupEntriesToStorage(storage: InMemoryStorageAdapter): Promise<void> {
    const groupIds = await storage.getGroupIds();
    const data: Record<string, LedgerEntry[]> = {};
    for (const gid of groupIds) {
        data[gid] = await storage.getAllEntries(gid);
    }
    localStorage.setItem(GROUPS_KEY, JSON.stringify(data));
}

async function loadGroupEntriesFromStorage(storage: InMemoryStorageAdapter): Promise<void> {
    try {
        const raw = localStorage.getItem(GROUPS_KEY);
        if (!raw) return;
        const data = JSON.parse(raw) as Record<string, LedgerEntry[]>;
        for (const [groupId, entries] of Object.entries(data)) {
            for (const entry of entries) {
                await storage.appendEntry(groupId as GroupId, entry);
            }
        }
    } catch {
        // Corrupted data, start fresh
    }
}

// ─── Provider ───

export function AppProvider({ children }: { children: ReactNode }) {
    const [identity, setIdentity] = useState<IdentityState | null>(() => loadIdentityFromStorage());
    const [groups, setGroups] = useState<GroupSummary[]>([]);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
    const [storageReady, setStorageReady] = useState(false);

    const storage = useMemo(() => new InMemoryStorageAdapter(), []);

    // Load persisted group entries on mount
    useEffect(() => {
        loadGroupEntriesFromStorage(storage).then(() => setStorageReady(true));
    }, [storage]);

    const persistEntries = useCallback(async () => {
        await saveGroupEntriesToStorage(storage);
    }, [storage]);

    const manager = useMemo(() => {
        if (!identity || !storageReady) return null;
        return new GroupManager({
            storage,
            deviceIdentity: identity.device,
            rootKeyPair: identity.rootKeyPair,
        });
    }, [identity, storage, storageReady]);

    // Relay transport + sync manager (created once when identity is ready)
    const transportRef = useRef<RelayTransport | null>(null);
    const syncManagerRef = useRef<SyncManager | null>(null);

    useEffect(() => {
        if (!identity) return;

        try {
            const transport = new RelayTransport({ url: getRelayWsUrl() });
            const syncMgr = new SyncManager({
                transport,
                storage,
                syncIntervalMs: 30_000,
            });

            transport.onConnectionState((state) => {
                setSyncStatus(state === 'connected' ? 'connected' : state === 'reconnecting' ? 'reconnecting' : 'disconnected');
            });

            syncMgr.on((_event: SyncEvent) => {
                // Refresh on sync events could be added here
            });

            transportRef.current = transport;
            syncManagerRef.current = syncMgr;
            setSyncStatus('connecting');

        } catch {
            // Relay unavailable — app works offline
            setSyncStatus('disconnected');
        }

        return () => {
            transportRef.current?.disconnectAll();
            syncManagerRef.current?.stopAll();
            transportRef.current = null;
            syncManagerRef.current = null;
            setSyncStatus('disconnected');
        };
    }, [identity, storage]);

    const createIdentity = useCallback((displayName: string) => {
        const root = createRootIdentity(displayName);
        const device = createDeviceIdentity(root.rootKeyPair, `${displayName}'s Browser`);
        const newIdentity = {
            displayName,
            rootKeyPair: root.rootKeyPair,
            device,
        };
        saveIdentityToStorage(newIdentity);
        setIdentity(newIdentity);
    }, []);

    const getGroupState = useCallback(async (groupId: GroupId) => {
        if (!manager) return null;
        return manager.getGroupState(groupId);
    }, [manager]);

    const getGroupEntries = useCallback(async (groupId: GroupId) => {
        const entries = await storage.getAllEntries(groupId);
        return orderEntries([...entries]);
    }, [storage]);

    // Auto-sync group with relay after creation or joining
    const syncGroupWithRelay = useCallback(async (groupId: GroupId) => {
        const syncMgr = syncManagerRef.current;
        if (!syncMgr || !identity) return;
        try {
            // Derive group key from group ID as shared secret
            const encoder = new TextEncoder();
            const groupKey = deriveGroupKey(encoder.encode(groupId), groupId);
            syncMgr.registerGroupKey(groupId, groupKey);
            await syncMgr.startSync(groupId);

            // Push local entries to relay (relay deduplicates)
            const localEntries = await storage.getAllEntries(groupId);
            for (const entry of localEntries) {
                try {
                    await syncMgr.broadcastEntry(groupId, entry);
                } catch {
                    // Entry may already exist on relay — ignore
                }
            }
        } catch {
            // Relay offline — continue in offline mode
        }
    }, [identity, storage]);

    // Pre-sync a group's entries from relay before joining
    const syncGroupFromRelay = useCallback(async (inviteLink: string): Promise<GroupId> => {
        const { token } = parseInviteLink(inviteLink);
        const groupId = token.groupId;
        const syncMgr = syncManagerRef.current;

        if (!syncMgr) {
            throw new Error('Not connected to relay');
        }

        // Register group key and sync (fetches + decrypts + stores all entries)
        const encoder = new TextEncoder();
        const groupKey = deriveGroupKey(encoder.encode(groupId), groupId);
        syncMgr.registerGroupKey(groupId, groupKey);
        await syncMgr.startSync(groupId);

        return groupId;
    }, []);

    // Broadcast a newly created entry to the relay
    const broadcastEntry = useCallback(async (groupId: GroupId, entry: LedgerEntry) => {
        const syncMgr = syncManagerRef.current;
        if (!syncMgr) return; // Relay offline — entry stays local
        try {
            await syncMgr.broadcastEntry(groupId, entry);
        } catch {
            // Relay offline — entry will be synced later
        }
    }, []);

    const refreshGroups = useCallback(async () => {
        if (!manager || !identity) return;
        const groupIds = await manager.listGroups();
        const summaries: GroupSummary[] = [];

        for (const groupId of groupIds) {
            const state = await manager.getGroupState(groupId);
            if (!state) continue;

            const entries = await storage.getAllEntries(groupId);
            const ordered = orderEntries([...entries]);
            const balances = computeBalances(ordered);
            const myBalance = balances.get(identity.rootKeyPair.publicKey) ?? 0;

            summaries.push({
                groupId,
                name: state.groupName,
                memberCount: [...state.members.values()].filter(m => m.isActive).length,
                myBalance,
                currency: getCurrency(ordered),
            });

            // Start sync for each group (idempotent)
            syncGroupWithRelay(groupId);
        }

        setGroups(summaries);

        // Persist entries to localStorage after refresh
        await persistEntries();
    }, [manager, identity, storage, syncGroupWithRelay, persistEntries]);

    // Auto-refresh when manager changes
    useEffect(() => {
        if (manager) {
            refreshGroups();
        }
    }, [manager, refreshGroups]);

    const restoreIdentity = useCallback((imported: IdentityState) => {
        saveIdentityToStorage(imported);
        setIdentity(imported);
    }, []);

    const value: AppContextValue = {
        identity,
        createIdentity,
        restoreIdentity,
        isOnboarded: identity !== null,
        manager,
        storage,
        groups,
        refreshGroups,
        getGroupState,
        getGroupEntries,
        syncStatus,
        syncGroupFromRelay,
        broadcastEntry,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ─── Hook ───

export function useApp(): AppContextValue {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used within AppProvider');
    return ctx;
}

// ─── Helpers ───

function getCurrency(entries: LedgerEntry[]): string {
    for (const e of entries) {
        if (e.entryType === EntryType.ExpenseCreated) {
            return (e.payload as { currency: string }).currency;
        }
    }
    return 'EUR';
}
