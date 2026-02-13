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
}

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

// ─── Provider ───

export function AppProvider({ children }: { children: ReactNode }) {
    const [identity, setIdentity] = useState<IdentityState | null>(null);
    const [groups, setGroups] = useState<GroupSummary[]>([]);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');

    const storage = useMemo(() => new InMemoryStorageAdapter(), []);

    const manager = useMemo(() => {
        if (!identity) return null;
        return new GroupManager({
            storage,
            deviceIdentity: identity.device,
            rootKeyPair: identity.rootKeyPair,
        });
    }, [identity, storage]);

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
        setIdentity({
            displayName,
            rootKeyPair: root.rootKeyPair,
            device,
        });
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
        } catch {
            // Relay offline — continue in offline mode
        }
    }, [identity]);

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
    }, [manager, identity, storage, syncGroupWithRelay]);

    // Auto-refresh when manager changes
    useEffect(() => {
        if (manager) {
            refreshGroups();
        }
    }, [manager, refreshGroups]);

    const value: AppContextValue = {
        identity,
        createIdentity,
        isOnboarded: identity !== null,
        manager,
        storage,
        groups,
        refreshGroups,
        getGroupState,
        getGroupEntries,
        syncStatus,
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
