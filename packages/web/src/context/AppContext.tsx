import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
    InMemoryStorageAdapter,
    GroupManager,
    createRootIdentity,
    createDeviceIdentity,
    computeBalances,
    orderEntries,
    validateFullChain,
    RelayTransport,
    SyncManager,
    deriveGroupKey,
    parseInviteLink,
    type GroupId,
    type GroupState,
    type LedgerEntry,
    type Ed25519KeyPair,
    type DeviceIdentity,
    type SecretKey,
    type PublicKey,

    EntryType,
    type Hash,
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
    deleteGroup: (groupId: GroupId) => Promise<void>;
    voidExpense: (groupId: GroupId, entryId: Hash, reason?: string) => Promise<void>;
    importIdentity: (qrPayload: string) => void;
    importIdentityFromJson: (jsonPayload: string) => void;
    createGroup: (name: string, currency: string) => Promise<GroupId>;
    refreshGroup: (groupId: GroupId) => Promise<void>;
    getConnectedGroups: () => GroupId[];
    lastUpdate: number;
    personalGroupId: GroupId | null;
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
            // Validate chain and derive state
            const result = validateFullChain(entries);
            if (result.valid && result.finalState) {
                for (const entry of entries) {
                    await storage.appendEntry(groupId as GroupId, entry);
                }
                await storage.saveGroupState(result.finalState);
            } else {
                console.warn(`[AppContext] Local storage chain invalid for group ${groupId}`, result.errors);
                // We could still append entries if we wanted, but state is broken. 
                // We'll trust that the sync manager will fetch correctly if local state is bad.
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
    const [lastUpdate, setLastUpdate] = useState(0);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
    const [storageReady, setStorageReady] = useState(false);

    const storage = useMemo(() => new InMemoryStorageAdapter(), []);
    const transportRef = useRef<RelayTransport | null>(null);
    const syncManagerRef = useRef<SyncManager | null>(null);

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

    // ─── Personal Sync Group ───
    const personalGroupId = useMemo(() => {
        if (!identity) return null;
        const p = identity.rootKeyPair.publicKey;
        return `${p.slice(0, 8)}-${p.slice(8, 12)}-${p.slice(12, 16)}-${p.slice(16, 20)}-${p.slice(20, 32)}` as GroupId;
    }, [identity]);

    // Ensure Personal Group exists and sync it
    useEffect(() => {
        if (!manager || !personalGroupId || !identity) return;

        const initPersonalGroup = async () => {
            const syncMgr = syncManagerRef.current;
            if (syncMgr) {
                // 1. Register for sync and try to fetch first
                const encoder = new TextEncoder();
                const groupKey = await deriveGroupKey(encoder.encode(personalGroupId), personalGroupId);
                syncMgr.registerGroupKey(personalGroupId, groupKey);

                try {
                    await syncMgr.initialSync(personalGroupId);
                } catch (e) {
                    console.debug("[AppContext] Personal group initial sync failed (offline or empty), will ensure local genesis", e);
                }

                syncMgr.startSync(personalGroupId);
            }

            // 2. Ensure it exists locally (create Genesis if not found after sync)
            await manager.ensurePersonalGroupExists(personalGroupId);
            // If we just created it, we should broadcast the Genesis?
            // ensurePersonalGroupExists adds to storage.
            // entries listener might pick it up? 
            // Better to explicitly broadcast if we created it.
            // But manager doesn't return "created" boolean easily.
            // However, syncMgr.startSync will pick up new local entries eventually or we can broadcast.

            if (syncMgr) {
                const entries = await storage.getAllEntries(personalGroupId);
                for (const entry of entries) {
                    // efficient enough for small personal group
                    syncMgr.broadcastEntry(personalGroupId, entry).catch(() => { });
                }
            }
        };

        initPersonalGroup();
    }, [manager, personalGroupId, identity, storage]);

    // ─── Core Methods ───

    const syncGroupById = useCallback(async (groupId: GroupId) => {
        const syncMgr = syncManagerRef.current;
        if (!syncMgr) return;

        const encoder = new TextEncoder();
        const groupKey = await deriveGroupKey(encoder.encode(groupId), groupId);
        syncMgr.registerGroupKey(groupId, groupKey);

        try {
            await syncMgr.initialSync(groupId);
        } catch (err) {
            console.warn('[AppContext] initialSync failed for group:', groupId, err);
        }
        syncMgr.startSync(groupId);
    }, []);

    const checkPersonalGroupForUpdates = useCallback(async () => {
        if (!storage || !personalGroupId) return;
        const entries = await storage.getAllEntries(personalGroupId);
        const ordered = orderEntries([...entries]);

        // Track the set of groups we should be a member of
        const activeGroups = new Map<GroupId, { groupName: string; currency: string }>();

        console.debug(`[PersonalSync] Recomputing active groups from ${ordered.length} entries`);

        for (const entry of ordered) {
            if (entry.entryType === EntryType.GroupJoined) {
                const p = entry.payload as { groupId: GroupId; groupName: string; currency: string };
                // console.debug(`[PersonalSync] Found GroupJoined: ${p.groupName} (${p.groupId})`);
                activeGroups.set(p.groupId, { ...p });
            } else if (entry.entryType === EntryType.GroupLeft) {
                const p = entry.payload as { groupId: GroupId };
                console.debug(`[PersonalSync] Found GroupLeft: ${p.groupId}`);
                activeGroups.delete(p.groupId);
            }
        }

        for (const [groupId, meta] of activeGroups) {
            const exists = await storage.getGroupState(groupId);
            if (!exists) {
                console.log(`[PersonalSync] Discovered new group: ${meta.groupName} (${groupId})`);
                await syncGroupById(groupId);
            }
        }
    }, [storage, personalGroupId, syncGroupById]);

    const syncGroupWithRelay = useCallback(async (groupId: GroupId) => {
        const syncMgr = syncManagerRef.current;
        if (!syncMgr || !identity || !manager) return;
        try {
            const encoder = new TextEncoder();
            const groupKey = await deriveGroupKey(encoder.encode(groupId), groupId);
            syncMgr.registerGroupKey(groupId, groupKey);

            try {
                await syncMgr.startSync(groupId);
            } catch (err) {
                console.warn(`[AppContext] Sync failed for ${groupId}, attempting broadcast anyway:`, err);
            }

            // Auto-authorize new device on this group if needed
            const state = await manager.getGroupState(groupId);
            if (state) {
                const me = state.members.get(identity.rootKeyPair.publicKey);
                // If I am a member, but THIS device's public key is not among the authorized devices
                if (me && me.isActive && !me.authorizedDevices.has(identity.device.deviceKeyPair.publicKey)) {
                    console.log(`[AppContext] Auto-authorizing imported device for expense group ${groupId}`);
                    try {
                        const authEntry = await manager.authorizeDevice(groupId, identity.device.deviceKeyPair.publicKey, identity.device.deviceName);
                        await syncMgr.broadcastEntry(groupId, authEntry);
                    } catch (authErr) {
                        console.warn(`[AppContext] Failed to auto-authorize device for expense group ${groupId}`, authErr);
                    }
                }
            }

            const localEntries = await storage.getAllEntries(groupId);
            for (const entry of localEntries) {
                try {
                    await syncMgr.broadcastEntry(groupId, entry);
                } catch { /* ignore */ }
            }
        } catch { /* Relay offline */ }
    }, [identity, storage, manager]);

    const refreshGroups = useCallback(async () => {
        if (!manager || !identity) return;

        if (personalGroupId) {
            await checkPersonalGroupForUpdates();
            // Check if WE are revoked from the identity by checking our own status in the Personal Group
            const personalState = await manager.getGroupState(personalGroupId);
            if (personalState) {
                const me = personalState.members.get(identity.rootKeyPair.publicKey);
                if (me && !me.authorizedDevices.has(identity.device.deviceKeyPair.publicKey)) {
                    console.warn(`[AppContext] This device was revoked from the identity! Logging out...`);
                    localStorage.clear();
                    window.location.reload();
                    return; // Stop processing
                }
            }
        }

        const groupIds = await manager.listGroups();
        const summaries: GroupSummary[] = [];
        const promises: Promise<void>[] = [];

        for (const groupId of groupIds) {
            if (groupId === personalGroupId) {
                // Ensure Personal Group is synced, but don't show in UI
                promises.push(syncGroupWithRelay(groupId));
                continue;
            }

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

            promises.push(syncGroupWithRelay(groupId));
        }

        setGroups(summaries);
        setLastUpdate(Date.now());
        await Promise.allSettled(promises);
        await persistEntries();
    }, [manager, identity, storage, syncGroupWithRelay, persistEntries, personalGroupId, checkPersonalGroupForUpdates]);

    const syncGroupFromRelay = useCallback(async (inviteLink: string): Promise<GroupId> => {
        const { token } = parseInviteLink(inviteLink);
        const groupId = token.groupId;

        await syncGroupById(groupId);

        const syncMgr = syncManagerRef.current;
        if (syncMgr) {
            const localEntries = await storage.getAllEntries(groupId);
            for (const entry of localEntries) {
                try {
                    await syncMgr.broadcastEntry(groupId, entry);
                } catch { /* ignore */ }
            }
        }

        // Announce join to personal group so it persists
        if (manager && personalGroupId) {
            try {
                // Wait a bit for sync? Or assume we have it?
                // syncGroupById started sync.
                // Let's try to get state.
                let state = await manager.getGroupState(groupId);
                if (!state) {
                    // Since sync is async, we might not have state yet.
                    // But we have the invite link token. We don't have group name in token.
                    // We must rely on sync.
                    // For now, let's just try once.
                }

                if (state) {
                    const entries = await storage.getAllEntries(groupId);
                    const currency = getCurrency(entries);
                    await manager.announceGroupJoin(personalGroupId, groupId, state.groupName, currency);
                }
            } catch (e) {
                console.warn("Failed to announce join to personal group", e);
            }
        }

        return groupId;
    }, [syncGroupById, storage, manager, personalGroupId]);

    const refreshGroup = useCallback(async (groupId: GroupId) => {
        if (!manager || !identity) return;
        const state = await manager.getGroupState(groupId);
        if (!state) return;

        const entries = await storage.getAllEntries(groupId);
        const ordered = orderEntries([...entries]);
        const balances = computeBalances(ordered);
        const myBalance = balances.get(identity.rootKeyPair.publicKey) ?? 0;

        setGroups(prev => prev.map(g => {
            if (g.groupId === groupId) {
                return {
                    ...g,
                    name: state.groupName,
                    memberCount: [...state.members.values()].filter(m => m.isActive).length,
                    myBalance,
                    currency: getCurrency(ordered),
                };
            }
            return g;
        }));
        setLastUpdate(Date.now());
    }, [manager, identity, storage]);

    const createGroup = useCallback(async (name: string, currency: string) => {
        if (!manager || !identity) throw new Error("Manager not ready");

        try {
            // Fix: Pass identity.displayName (or undefined) as the second argument, NOT currency.
            // currency is part of the GroupJoined announcement, not the Genesis entry (which uses displayName).
            const result = await manager.createGroup(name, identity.displayName);
            const groupId = result.groupId;

            if (personalGroupId) {
                await manager.announceGroupJoin(personalGroupId, groupId, name, currency);
                const syncMgr = syncManagerRef.current;
                if (syncMgr) {
                    const entries = await storage.getAllEntries(personalGroupId);
                    const latest = entries[entries.length - 1];
                    if (latest) syncMgr.broadcastEntry(personalGroupId, latest);
                }
            }

            const newGroupSummary: GroupSummary = {
                groupId,
                name,
                memberCount: 1,
                myBalance: 0,
                currency,
            };

            setGroups(prev => [newGroupSummary, ...prev]);

            syncGroupById(groupId);
            refreshGroups();

            return groupId;
        } catch (e) {
            console.error("Failed to create group", e);
            throw e;
        }
    }, [manager, identity, refreshGroups, syncGroupById, personalGroupId, storage]);

    const broadcastEntry = useCallback(async (groupId: GroupId, entry: LedgerEntry) => {
        const syncMgr = syncManagerRef.current;
        if (!syncMgr) return;
        try {
            await syncMgr.broadcastEntry(groupId, entry);
        } catch { }
    }, []);

    const deleteGroup = useCallback(async (groupId: GroupId) => {
        const syncMgr = syncManagerRef.current;
        if (personalGroupId && manager) {
            try {
                const entry = await manager.announceGroupLeave(personalGroupId, groupId);
                if (syncMgr) {
                    syncMgr.broadcastEntry(personalGroupId, entry).catch(() => { });
                }
            } catch (e) {
                console.warn("Failed to announce group leave", e);
            }
        }

        if (syncMgr) {
            await syncMgr.stopSync(groupId);
        }
        if (manager) {
            await manager.deleteGroup(groupId);
        }
        await refreshGroups();
    }, [manager, refreshGroups, personalGroupId]);

    const voidExpense = useCallback(async (groupId: GroupId, entryId: Hash, reason?: string) => {
        if (!manager) return;
        const entry = await manager.voidExpense(groupId, entryId, reason);
        await broadcastEntry(groupId, entry);
        await refreshGroup(groupId);
    }, [manager, broadcastEntry, refreshGroup]);

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

    const importIdentity = useCallback((importedRootSecretKey: string) => {
        try {
            const data = JSON.parse(importedRootSecretKey);
            const { rootSecretKey, rootPublicKey, displayName } = data;

            if (!rootSecretKey || !rootPublicKey || !displayName) {
                throw new Error("Invalid QR Code data");
            }

            const rootKeyPair: Ed25519KeyPair = {
                secretKey: rootSecretKey as SecretKey,
                publicKey: rootPublicKey as PublicKey
            };

            const ua = navigator.userAgent;
            const isIOS = /iPad|iPhone|iPod/.test(ua);
            const isMac = /Mac OS X/.test(ua);
            const isAndroid = /Android/.test(ua);
            const isWindows = /Windows/.test(ua);
            const platform = isIOS ? 'iOS Device' : isMac ? 'Mac' : isAndroid ? 'Android Device' : isWindows ? 'Windows PC' : 'Browser';

            const deviceName = `${displayName}'s ${platform}`;
            const device = createDeviceIdentity(rootKeyPair, deviceName);

            const newIdentity: IdentityState = {
                displayName,
                rootKeyPair,
                device
            };

            saveIdentityToStorage(newIdentity);
            setIdentity(newIdentity);
            return true;
        } catch (e) {
            console.error("Failed to import identity from QR", e);
            throw e;
        }
    }, []);

    const importIdentityFromJson = useCallback((jsonPayload: string) => {
        try {
            const data = JSON.parse(jsonPayload) as IdentityState;
            const { rootKeyPair, displayName } = data;

            if (!rootKeyPair || !rootKeyPair.publicKey || !rootKeyPair.secretKey || !displayName) {
                throw new Error("Invalid Identity JSON data");
            }

            const ua = navigator.userAgent;
            const isIOS = /iPad|iPhone|iPod/.test(ua);
            const isMac = /Mac OS X/.test(ua);
            const isAndroid = /Android/.test(ua);
            const isWindows = /Windows/.test(ua);
            const platform = isIOS ? 'iOS Device' : isMac ? 'Mac' : isAndroid ? 'Android Device' : isWindows ? 'Windows PC' : 'Browser';

            const deviceName = `${displayName}'s ${platform}`;
            const device = createDeviceIdentity(rootKeyPair, deviceName);

            const newIdentity: IdentityState = {
                displayName,
                rootKeyPair,
                device
            };

            saveIdentityToStorage(newIdentity);
            setIdentity(newIdentity);
        } catch (e) {
            console.error("Failed to import identity from JSON", e);
            throw e;
        }
    }, []);

    const restoreIdentity = useCallback((imported: IdentityState) => {
        saveIdentityToStorage(imported);
        setIdentity(imported);
    }, []);

    const getGroupState = useCallback(async (groupId: GroupId) => {
        if (!manager) return null;
        return manager.getGroupState(groupId);
    }, [manager]);

    const getGroupEntries = useCallback(async (groupId: GroupId) => {
        const entries = await storage.getAllEntries(groupId);
        return orderEntries([...entries]);
    }, [storage]);

    // Setup Sync Manager
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

            syncMgr.on(async (event) => {
                if (event.type === 'entry:received') {
                    await saveGroupEntriesToStorage(storage);
                    if (personalGroupId && event.groupId === personalGroupId) {
                        await checkPersonalGroupForUpdates();
                        refreshGroups();
                    } else {
                        refreshGroups();
                    }
                }
            });

            transportRef.current = transport;
            syncManagerRef.current = syncMgr;
            setSyncStatus('connecting');
        } catch {
            setSyncStatus('disconnected');
        }

        return () => {
            transportRef.current?.disconnectAll();
            syncManagerRef.current?.stopAll();
            transportRef.current = null;
            syncManagerRef.current = null;
            setSyncStatus('disconnected');
        };
    }, [identity, storage, refreshGroups, personalGroupId, checkPersonalGroupForUpdates]);

    // Initialize sync for existing groups
    useEffect(() => {
        const syncMgr = syncManagerRef.current;
        if (!syncMgr || !identity || groups.length === 0) return;

        const initGroups = async () => {
            for (const g of groups) {
                try {
                    const encoder = new TextEncoder();
                    const groupKey = await deriveGroupKey(encoder.encode(g.groupId), g.groupId);
                    syncMgr.registerGroupKey(g.groupId, groupKey);
                    await syncMgr.startSync(g.groupId);
                } catch (err) { }
            }
        };
        initGroups();
    }, [groups, identity]);

    // Initial load of groups from manager
    useEffect(() => {
        if (manager && identity) {
            refreshGroups();
        }
    }, [manager, identity, refreshGroups]);



    const getConnectedGroups = useCallback(() => {
        return transportRef.current?.getConnectedGroups() ?? [];
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
        deleteGroup,
        voidExpense,
        importIdentity,
        importIdentityFromJson,
        createGroup,
        refreshGroup,
        getConnectedGroups,
        lastUpdate,
        personalGroupId,
    } as AppContextValue;

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
