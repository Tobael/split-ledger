/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
    GroupManager,
    createRootIdentity,
    createDeviceIdentity,
    computeBalances,
    orderEntries,
    RelayTransport,
    SyncManager,
    deriveGroupKey,
    encryptForRelay,
    decryptFromRelay,
    parseInviteLink,
    parseInviteV2,
    groupAccessFromInviteV2,
    groupAccessV2Schema,
    signedOperationV2Schema,
    hash,
    generateKeyPair,
    type GroupId,
    type GroupState,
    type LedgerEntry,
    type Ed25519KeyPair,
    type DeviceIdentity,
    type ExpenseCreatedPayload,
    type StorageAdapter,
    GroupServiceV2,
    createGroupAccessV2,
    type GroupStateV2,
    type GroupAccessV2,
    type InvitePayloadV2,
    type ExpenseDataV2,

    EntryType,
    type Hash,
} from '@splitledger/core';
import { IndexedDbStorageAdapter } from '../storage/IndexedDbStorageAdapter';
import { IndexedDbOperationStorageV2 } from '../storage/IndexedDbOperationStorageV2';
import { isDeviceExplicitlyRevoked } from '../utils/device-authorization';

// ─── Types ───

interface IdentityState {
    displayName: string;
    rootKeyPair: Ed25519KeyPair;
    device: DeviceIdentity;
}

interface IdentityTransferV2 {
    format: 'fair-money-identity-transfer';
    version: 2;
    identity: Pick<IdentityState, 'displayName' | 'rootKeyPair'>;
    groupAccess: GroupAccessV2[];
}

interface GroupSummary {
    groupId: GroupId;
    name: string;
    memberCount: number;
    myBalance: number;
    currency: string;
    protocolVersion: 1 | 2;
}

type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface AppContextValue {
    // Identity
    identity: IdentityState | null;
    createIdentity: (displayName: string) => Promise<void>;
    restoreIdentity: (imported: IdentityState) => Promise<void>;
    isOnboarded: boolean;
    identityReady: boolean;

    // Group Manager
    manager: GroupManager | null;
    storage: StorageAdapter;

    // Groups
    groups: GroupSummary[];
    refreshGroups: () => Promise<void>;

    // Group detail helpers
    getGroupState: (groupId: GroupId) => Promise<GroupState | null>;
    getGroupEntries: (groupId: GroupId) => Promise<LedgerEntry[]>;
    getGroupStateV2: (groupId: GroupId) => Promise<GroupStateV2 | null>;
    createParticipantSlotV2: (groupId: GroupId, displayName: string) => Promise<void>;
    createOrReplaceInviteV2: (groupId: GroupId, participantId: string) => Promise<string>;
    createOrReplaceGenericInviteV2: (groupId: GroupId) => Promise<string>;
    prepareInviteV2: (inviteLink: string) => Promise<{ invite: InvitePayloadV2; state: GroupStateV2 | null }>;
    claimInviteV2: (inviteLink: string, participantId?: string) => Promise<GroupId>;
    createExpenseV2: (groupId: GroupId, expense: ExpenseDataV2) => Promise<void>;
    correctExpenseV2: (groupId: GroupId, expenseId: string, expense: ExpenseDataV2, reason: string) => Promise<void>;
    voidExpenseV2: (groupId: GroupId, expenseId: string, reason?: string) => Promise<void>;
    createSettlementV2: (groupId: GroupId, from: string, to: string, amountMinorUnits: number, currency: string) => Promise<void>;
    renameParticipantV2: (groupId: GroupId, participantId: string, displayName: string) => Promise<void>;
    disableParticipantV2: (groupId: GroupId, participantId: string) => Promise<void>;
    resetParticipantV2: (groupId: GroupId, participantId: string) => Promise<void>;
    getAuthorizedDevicesV2: () => Promise<Map<string, { name: string; groups: GroupId[] }>>;
    revokeDeviceV2: (devicePublicKey: string) => Promise<void>;

    // Sync
    syncStatus: SyncStatus;
    groupsWaitingForHistory: ReadonlySet<GroupId>;

    syncGroupFromRelay: (inviteLink: string) => Promise<GroupId>;
    broadcastEntry: (groupId: GroupId, entry: LedgerEntry) => Promise<void>;
    deleteGroup: (groupId: GroupId) => Promise<void>;
    voidExpense: (groupId: GroupId, entryId: Hash, reason?: string) => Promise<void>;
    correctExpense: (groupId: GroupId, entryId: Hash, expense: ExpenseCreatedPayload, reason?: string) => Promise<void>;
    importIdentity: (qrPayload: string) => Promise<boolean>;
    importIdentityFromJson: (jsonPayload: string) => Promise<void>;
    exportIdentityTransferV2: () => Promise<string>;
    createGroup: (name: string, currency: string) => Promise<GroupId>;
    refreshGroup: (groupId: GroupId) => Promise<void>;
    getConnectedGroups: () => GroupId[];
    lastUpdate: number;
    personalGroupId: GroupId | null;
    persistenceWarning: string | null;
    deleteIdentity: () => Promise<void>;
}

export type { IdentityState };

const AppContext = createContext<AppContextValue | null>(null);

// ─── Relay URL ───

function getRelayWsUrl(): string {
    const configured = import.meta.env.VITE_RELAY_URL as string | undefined;
    if (configured) return relayWebSocketUrl(configured);
    // Local development uses Vite's /ws proxy. Production images inject the
    // independently hosted relay URL at build time.
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws`;
}

function normalizedRelayUrl(): string {
    return getRelayWsUrl();
}

function relayCapability(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
    let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function relayWebSocketUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    else if (url.protocol === 'http:') url.protocol = 'ws:';
    return url.toString();
}

// ─── Provider ───

export function AppProvider({ children }: { children: ReactNode }) {
    const [identity, setIdentity] = useState<IdentityState | null>(null);
    const [identityReady, setIdentityReady] = useState(false);
    const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
    const [groups, setGroups] = useState<GroupSummary[]>([]);
    const [lastUpdate, setLastUpdate] = useState(0);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
    const [groupsWaitingForHistory, setGroupsWaitingForHistory] = useState<Set<GroupId>>(() => new Set());
    const [storageReady, setStorageReady] = useState(false);

    const storage = useMemo<StorageAdapter>(() => new IndexedDbStorageAdapter(), []);
    const operationStorageV2 = useMemo(() => new IndexedDbOperationStorageV2(), []);
    const groupServiceV2 = useMemo(() => new GroupServiceV2(operationStorageV2), [operationStorageV2]);
    const transportRef = useRef<RelayTransport | null>(null);
    const syncManagerRef = useRef<SyncManager | null>(null);

    const syncGroupV2 = useCallback(async (access: GroupAccessV2): Promise<GroupStateV2 | null> => {
        const groupId = access.groupId as GroupId;
        const transport = new RelayTransport({
            url: relayWebSocketUrl(access.relayUrl),
            groupCapabilities: { [access.groupId]: access.relayGroupCapability },
        });
        const groupKey = deriveGroupKey(base64UrlToBytes(access.groupSecret), groupId);
        try {
            await transport.connect(groupId);
            const remote = await transport.getOperations(groupId);
            const operations = remote.map((envelope) => {
                const plaintext = decryptFromRelay(base64ToBytes(envelope.encryptedOperation), groupKey);
                const operation = signedOperationV2Schema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
                if (operation.operationId !== envelope.operationId) {
                    throw new Error('Relay operation ID does not match its signed operation');
                }
                return operation;
            });
            const localBeforeSync = await groupServiceV2.getOperations(access.groupId);
            if (operations.length > 0) {
                if (localBeforeSync.length === 0
                    && !operations.some(({ payload }) => payload.type === 'GroupCreated')) return null;
                try {
                    await groupServiceV2.acceptOperations(access.groupId, operations);
                } catch (error) {
                    if (error instanceof Error && error.message.startsWith('Missing protocol v2 parent:')) {
                        return groupServiceV2.getGroupState(access.groupId);
                    }
                    throw error;
                }
            }

            const local = await groupServiceV2.getOperations(access.groupId);
            for (const operation of local) {
                const plaintext = new TextEncoder().encode(JSON.stringify(operation));
                await transport.publishEntry(groupId, {
                    operationId: operation.operationId,
                    encryptedOperation: bytesToBase64(encryptForRelay(plaintext, groupKey)),
                });
            }
            return groupServiceV2.getGroupState(access.groupId);
        } finally {
            await transport.disconnectAll();
        }
    }, [groupServiceV2]);

    // Load persisted group entries on mount
    useEffect(() => {
        const initializeStorage = async () => {
            const root = await storage.getRootIdentity();
            const device = await storage.getDeviceIdentity();

            if (root && device) {
                setIdentity({ displayName: root.displayName, rootKeyPair: root.rootKeyPair, device });
            }
            await storage.getGroupIds();
            setStorageReady(true);
            setIdentityReady(true);
        };

        initializeStorage()
            .catch(() => {
                setPersistenceWarning('Identity or ledger storage could not be opened.');
                setIdentityReady(true);
            });
    }, [storage]);

    const persistIdentity = useCallback(async (nextIdentity: IdentityState) => {
        await storage.storeRootIdentity({
            rootKeyPair: nextIdentity.rootKeyPair,
            displayName: nextIdentity.displayName,
            createdAt: Date.now(),
        });
        await storage.storeDeviceIdentity(nextIdentity.device);
        setIdentity(nextIdentity);
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
                transportRef.current?.setGroupCapability(personalGroupId, relayCapability(groupKey));
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

    const syncGroupById = useCallback(async (groupId: GroupId, expectHistory = false) => {
        const syncMgr = syncManagerRef.current;
        if (!syncMgr) return null;

        const encoder = new TextEncoder();
        const groupKey = await deriveGroupKey(encoder.encode(groupId), groupId);
        transportRef.current?.setGroupCapability(groupId, relayCapability(groupKey));
        syncMgr.registerGroupKey(groupId, groupKey);

        let initialState: GroupState | null = null;
        try {
            initialState = await syncMgr.initialSync(groupId, { expectHistory });
        } catch {
            console.warn('[AppContext] Initial group synchronization failed');
        }
        void syncMgr.startSync(groupId).catch(() => {
            // The background synchronizer will retry when the relay becomes reachable.
        });
        return initialState;
    }, []);

    const checkPersonalGroupForUpdates = useCallback(async () => {
        if (!storage || !personalGroupId) return;
        const entries = await storage.getAllEntries(personalGroupId);
        const ordered = orderEntries([...entries]);

        // Track the set of groups we should be a member of
        const activeGroups = new Map<GroupId, { groupName: string; currency: string }>();


        for (const entry of ordered) {
            if (entry.entryType === EntryType.GroupJoined) {
                const p = entry.payload as { groupId: GroupId; groupName: string; currency: string };
                activeGroups.set(p.groupId, { ...p });
            } else if (entry.entryType === EntryType.GroupLeft) {
                const p = entry.payload as { groupId: GroupId };
                activeGroups.delete(p.groupId);
            }
        }

        for (const groupId of activeGroups.keys()) {
            const exists = await storage.getGroupState(groupId);
            if (!exists) {
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
            transportRef.current?.setGroupCapability(groupId, relayCapability(groupKey));
            syncMgr.registerGroupKey(groupId, groupKey);

            try {
                await syncMgr.startSync(groupId);
            } catch {
                console.warn('[AppContext] Group synchronization failed; local data remains available');
            }

            // Auto-authorize new device on this group if needed
            const state = await manager.getGroupState(groupId);
            if (state) {
                const me = state.members.get(identity.rootKeyPair.publicKey);
                // If I am a member, but THIS device's public key is not among the authorized devices
                if (me && me.isActive && !me.authorizedDevices.has(identity.device.deviceKeyPair.publicKey)) {
                    try {
                        const authEntry = await manager.authorizeDevice(groupId, identity.device.deviceKeyPair.publicKey, identity.device.deviceName);
                        await syncMgr.broadcastEntry(groupId, authEntry);
                    } catch {
                        console.warn('[AppContext] Failed to authorize imported device for a group');
                    }
                }
            }

            const localEntries = await storage.getAllEntries(groupId);
            for (const entry of localEntries) {
                try {
                    await syncMgr.broadcastEntry(groupId, entry);
                } catch { /* ignore */ }
            }
        } catch { /* Relay offline; local operation remains available. */ }
    }, [identity, storage, manager]);

    const broadcastEntry = useCallback(async (groupId: GroupId, entry: LedgerEntry) => {
        const syncMgr = syncManagerRef.current;
        if (!syncMgr) return;
        try {
            await syncMgr.broadcastEntry(groupId, entry);
        } catch { /* Synchronization retries in the background. */ }
    }, []);

    const performRootKeyRotation = useCallback(async () => {
        if (!manager || !identity || !personalGroupId) return;
        try {
            console.log("[AppContext] Starting Root Key Auto-Rotation for JSON import...");

            // FORCE a full sync of the personal group and all discovered expense groups
            // so that we don't accidentally leave some expense groups un-rotated.
            console.log("[AppContext] Force syncing groups before rotation...");
            await syncGroupById(personalGroupId);
            await checkPersonalGroupForUpdates();

            const newRootKeyPair = generateKeyPair();

            // 1. Rotate in Personal Group
            const pEntry = await manager.rotateRootKey(personalGroupId, identity.rootKeyPair.secretKey, newRootKeyPair);
            await broadcastEntry(personalGroupId, pEntry);

            // 2. Rotate in all Expense Groups
            const activeGroupIds = await manager.listGroups();
            for (const gid of activeGroupIds) {
                if (gid !== personalGroupId) {
                    try {
                        const entry = await manager.rotateRootKey(gid, identity.rootKeyPair.secretKey, newRootKeyPair);
                        await broadcastEntry(gid, entry);
                    } catch (err) {
                        console.error(`[AppContext] Failed to rotate root key in group ${gid}:`, err);
                    }
                }
            }

            // 3. Update Identity locally
            const newIdentity: IdentityState = {
                ...identity,
                rootKeyPair: newRootKeyPair,
            };
            await persistIdentity(newIdentity);

            localStorage.removeItem('PENDING_JSON_ROTATION');
            console.log("[AppContext] Root Key Auto-Rotation complete!");
            alert("Security Notice: Your imported identity has been automatically secured with a new Root Key. The imported JSON file can no longer be used.");
        } catch (e) {
            console.error("[AppContext] Failed to auto-rotate root key", e);
        }
    }, [manager, identity, personalGroupId, broadcastEntry, syncGroupById, checkPersonalGroupForUpdates, persistIdentity]);

    const refreshGroups = useCallback(async () => {
        if (!manager || !identity) return;

        if (personalGroupId) {
            await checkPersonalGroupForUpdates();
            // Check if WE are revoked from the identity by checking our own status in the Personal Group
            const personalState = await manager.getGroupState(personalGroupId);
            if (personalState) {
                const me = personalState.members.get(identity.rootKeyPair.publicKey);
                const personalEntries = await storage.getAllEntries(personalGroupId);
                const explicitlyRevoked = isDeviceExplicitlyRevoked(
                    personalEntries,
                    identity.device.deviceKeyPair.publicKey,
                );

                // A newly created identity briefly has a personal-group member before
                // ensurePersonalGroupExists() appends its DeviceAuthorized entry. Absence
                // from authorizedDevices is therefore not proof of revocation.
                if (me && explicitlyRevoked) {
                    console.warn(`[AppContext] This device was revoked from the identity! Logging out...`);
                    await storage.clearIdentity();
                    localStorage.removeItem('PENDING_JSON_ROTATION');
                    setIdentity(null);
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
                protocolVersion: 1,
            });

            promises.push(syncGroupWithRelay(groupId));
        }

        for (const groupId of await groupServiceV2.getGroupIds()) {
            const state = await groupServiceV2.getGroupState(groupId);
            if (!state) continue;
            const participant = Object.values(state.participants).find(
                ({ claimedRootPublicKey }) => claimedRootPublicKey === identity.rootKeyPair.publicKey,
            );
            if (!participant) continue;
            const currency = Object.keys(state.balances).sort()[0] ?? 'EUR';
            summaries.push({
                groupId: groupId as GroupId,
                name: state.groupName,
                memberCount: Object.values(state.participants).filter(({ status }) => status !== 'disabled').length,
                myBalance: state.balances[currency]?.[participant.participantId] ?? 0,
                currency,
                protocolVersion: 2,
            });
        }

        setGroups(summaries);
        setLastUpdate(Date.now());
        await Promise.allSettled(promises);

        // Check if we need to rotate root key after importing JSON
        if (localStorage.getItem('PENDING_JSON_ROTATION') === 'true') {
            await performRootKeyRotation();
        }
    }, [manager, identity, storage, syncGroupWithRelay, personalGroupId, checkPersonalGroupForUpdates, performRootKeyRotation, groupServiceV2]);

    const syncGroupFromRelay = useCallback(async (inviteLink: string): Promise<GroupId> => {
        const { token } = parseInviteLink(inviteLink);
        const groupId = token.groupId;

        await syncGroupById(groupId, true);

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
                const state = await manager.getGroupState(groupId);
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
        if (!identity) throw new Error("Identity not ready");

        try {
            const state = await groupServiceV2.createGroup({
                groupName: name,
                creatorDisplayName: identity.displayName,
                creator: identity.rootKeyPair,
            });
            const groupId = state.groupId as GroupId;
            await groupServiceV2.authorizeDevice(
                groupId,
                identity.rootKeyPair,
                identity.device.deviceKeyPair.publicKey,
                identity.device.deviceName,
            );
            const access = createGroupAccessV2(groupId, normalizedRelayUrl());
            await operationStorageV2.storeGroupAccess(access);
            void syncGroupV2(access).catch(() => {
                // The group remains fully usable offline and will be republished later.
            });

            const newGroupSummary: GroupSummary = {
                groupId,
                name,
                memberCount: 1,
                myBalance: 0,
                currency,
                protocolVersion: 2,
            };

            setGroups(prev => [newGroupSummary, ...prev]);

            await refreshGroups();

            return groupId;
        } catch (e) {
            console.error("Failed to create group", e);
            throw e;
        }
    }, [identity, refreshGroups, groupServiceV2, operationStorageV2, syncGroupV2]);



    const deleteGroup = useCallback(async (groupId: GroupId) => {
        if (await groupServiceV2.getGroupState(groupId)) {
            await groupServiceV2.deleteGroup(groupId);
            await operationStorageV2.deleteGroupAccess(groupId);
            await refreshGroups();
            return;
        }
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
        setGroupsWaitingForHistory((current) => {
            if (!current.has(groupId)) return current;
            const next = new Set(current);
            next.delete(groupId);
            return next;
        });
    }, [manager, refreshGroups, personalGroupId, groupServiceV2, operationStorageV2]);

    const voidExpense = useCallback(async (groupId: GroupId, entryId: Hash, reason?: string) => {
        if (!manager) return;
        const entry = await manager.voidExpense(groupId, entryId, reason);
        await broadcastEntry(groupId, entry);
        await refreshGroup(groupId);
    }, [manager, broadcastEntry, refreshGroup]);

    const correctExpense = useCallback(async (
        groupId: GroupId,
        entryId: Hash,
        expense: ExpenseCreatedPayload,
        reason?: string,
    ) => {
        if (!manager) return;
        const entry = await manager.correctExpense(groupId, entryId, expense, reason);
        await broadcastEntry(groupId, entry);
        await refreshGroup(groupId);
    }, [manager, broadcastEntry, refreshGroup]);

    const createIdentity = useCallback(async (displayName: string) => {
        const root = createRootIdentity(displayName);
        const device = createDeviceIdentity(root.rootKeyPair, `${displayName}'s Browser`);
        const newIdentity = {
            displayName,
            rootKeyPair: root.rootKeyPair,
            device,
        };
        await persistIdentity(newIdentity);
    }, [persistIdentity]);

    const importIdentityFromJson = useCallback(async (jsonPayload: string) => {
        const data = JSON.parse(jsonPayload) as IdentityTransferV2;
        if (data.format !== 'fair-money-identity-transfer' || data.version !== 2
            || !data.identity?.rootKeyPair?.publicKey || !data.identity.rootKeyPair.secretKey
            || !data.identity.displayName || !Array.isArray(data.groupAccess)) {
            throw new Error('Invalid identity transfer package');
        }
        const { rootKeyPair, displayName } = data.identity;
        const accesses = data.groupAccess.map((access) => groupAccessV2Schema.parse(access));

        const ua = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(ua);
        const isMac = /Mac OS X/.test(ua);
        const isAndroid = /Android/.test(ua);
        const isWindows = /Windows/.test(ua);
        const platform = isIOS ? 'iOS Device' : isMac ? 'Mac' : isAndroid ? 'Android Device' : isWindows ? 'Windows PC' : 'Browser';

        const deviceName = `${displayName}'s ${platform}`;
        const device = createDeviceIdentity(rootKeyPair, deviceName);
        const newIdentity: IdentityState = { displayName, rootKeyPair, device };

        for (const groupId of await groupServiceV2.getGroupIds()) {
            await groupServiceV2.deleteGroup(groupId);
            await operationStorageV2.deleteGroupAccess(groupId);
        }
        for (const groupId of await storage.getGroupIds()) await storage.deleteGroup(groupId);
        await persistIdentity(newIdentity);
        for (const access of accesses) {
            await operationStorageV2.storeGroupAccess(access);
            try {
                const state = await syncGroupV2(access);
                const ownsParticipant = state && Object.values(state.participants).some(
                    ({ claimedRootPublicKey, status }) => claimedRootPublicKey === rootKeyPair.publicKey && status === 'claimed',
                );
                const deviceIsKnown = state?.devices[device.deviceKeyPair.publicKey] !== undefined;
                if (ownsParticipant && !deviceIsKnown) {
                    await groupServiceV2.authorizeDevice(
                        access.groupId,
                        rootKeyPair,
                        device.deviceKeyPair.publicKey,
                        device.deviceName,
                    );
                    await syncGroupV2(access);
                }
            } catch {
                // Access is durable; background synchronization authorizes the new device later.
            }
        }
        await refreshGroups();
    }, [groupServiceV2, operationStorageV2, persistIdentity, refreshGroups, storage, syncGroupV2]);

    const importIdentity = useCallback(async (transferPayload: string) => {
        await importIdentityFromJson(transferPayload);
        return true;
    }, [importIdentityFromJson]);

    const exportIdentityTransferV2 = useCallback(async () => {
        if (!identity) throw new Error('Identity not ready');
        const groupAccess: GroupAccessV2[] = [];
        for (const groupId of await groupServiceV2.getGroupIds()) {
            const access = await operationStorageV2.getGroupAccess(groupId);
            if (access) groupAccess.push(access);
        }
        return JSON.stringify({
            format: 'fair-money-identity-transfer',
            version: 2,
            identity: { displayName: identity.displayName, rootKeyPair: identity.rootKeyPair },
            groupAccess,
        } satisfies IdentityTransferV2);
    }, [groupServiceV2, identity, operationStorageV2]);

    const restoreIdentity = useCallback(async (imported: IdentityState) => {
        await persistIdentity(imported);
    }, [persistIdentity]);

    const deleteIdentity = useCallback(async () => {
        await syncManagerRef.current?.stopAll();
        for (const groupId of await storage.getGroupIds()) {
            await storage.deleteGroup(groupId);
        }
        await storage.clearIdentity();
        localStorage.removeItem('PENDING_JSON_ROTATION');
        setIdentity(null);
    }, [storage]);

    const getGroupState = useCallback(async (groupId: GroupId) => {
        if (!manager) return null;
        return manager.getGroupState(groupId);
    }, [manager]);

    const getGroupEntries = useCallback(async (groupId: GroupId) => {
        const entries = await storage.getAllEntries(groupId);
        return orderEntries([...entries]);
    }, [storage]);

    const getGroupStateV2 = useCallback(async (groupId: GroupId) => {
        return groupServiceV2.getGroupState(groupId);
    }, [groupServiceV2]);

    const createParticipantSlotV2 = useCallback(async (groupId: GroupId, displayName: string) => {
        if (!identity) throw new Error('Identity not ready');
        const normalizedName = displayName.trim();
        if (!normalizedName) throw new Error('Participant name is required');
        await groupServiceV2.createParticipantSlot(groupId, identity.rootKeyPair, normalizedName);
        const access = await operationStorageV2.getGroupAccess(groupId);
        if (access) void syncGroupV2(access).catch(() => {});
        await refreshGroups();
    }, [groupServiceV2, identity, operationStorageV2, refreshGroups, syncGroupV2]);

    const createOrReplaceInviteV2 = useCallback(async (groupId: GroupId, participantId: string) => {
        if (!identity) throw new Error('Identity not ready');
        const [state, access] = await Promise.all([
            groupServiceV2.getGroupState(groupId),
            operationStorageV2.getGroupAccess(groupId),
        ]);
        if (!state || !access) throw new Error('Local group access is unavailable');
        if (state.participants[participantId]?.status !== 'unclaimed') {
            throw new Error('Only unclaimed participant slots can receive invites');
        }
        for (const capability of Object.values(state.capabilities)) {
            if (capability.participantId === participantId && capability.status === 'active') {
                await groupServiceV2.revokeInvite(groupId, identity.rootKeyPair, capability.capabilityId);
            }
        }
        const issued = await groupServiceV2.issueInviteForGroup(groupId, {
            actor: identity.rootKeyPair,
            participantId,
            joinBaseUrl: window.location.origin,
            relayUrl: access.relayUrl,
            relayGroupCapability: access.relayGroupCapability,
            groupSecret: access.groupSecret,
        });
        await syncGroupV2(access);
        setLastUpdate(Date.now());
        return issued.invite.url;
    }, [groupServiceV2, identity, operationStorageV2, syncGroupV2]);

    const createOrReplaceGenericInviteV2 = useCallback(async (groupId: GroupId) => {
        if (!identity) throw new Error('Identity not ready');
        const [state, access] = await Promise.all([
            groupServiceV2.getGroupState(groupId),
            operationStorageV2.getGroupAccess(groupId),
        ]);
        if (!state || !access) throw new Error('Local group access is unavailable');
        if (!Object.values(state.participants).some(({ status }) => status === 'unclaimed')) {
            throw new Error('A generic invite requires an unclaimed participant slot');
        }
        for (const capability of Object.values(state.capabilities)) {
            if (capability.scope === 'any-unclaimed-slot' && capability.status === 'active') {
                await groupServiceV2.revokeInvite(groupId, identity.rootKeyPair, capability.capabilityId);
            }
        }
        const issued = await groupServiceV2.issueInviteForGroup(groupId, {
            actor: identity.rootKeyPair,
            scope: 'any-unclaimed-slot',
            joinBaseUrl: window.location.origin,
            relayUrl: access.relayUrl,
            relayGroupCapability: access.relayGroupCapability,
            groupSecret: access.groupSecret,
        });
        await syncGroupV2(access);
        setLastUpdate(Date.now());
        return issued.invite.url;
    }, [groupServiceV2, identity, operationStorageV2, syncGroupV2]);

    const prepareInviteV2 = useCallback(async (inviteLink: string) => {
        const invite = parseInviteV2(inviteLink);
        const access = groupAccessFromInviteV2(invite);
        await operationStorageV2.storeGroupAccess(access);
        const state = await syncGroupV2(access);
        if (!state) return { invite, state: null };

        const issue = await operationStorageV2.getOperation(invite.issueOperationId);
        if (!issue || issue.groupId !== invite.groupId || issue.payload.type !== 'ClaimCapabilityIssued') {
            throw new Error('Invite issue operation is unavailable');
        }
        const expectedCommitment = hash(base64UrlToBytes(invite.claimSecret));
        if (issue.payload.capabilityId !== invite.capabilityId
            || issue.payload.scope !== invite.scope
            || issue.payload.participantId !== invite.participantId
            || issue.payload.secretCommitment !== expectedCommitment) {
            throw new Error('Invite does not match its signed capability');
        }
        return { invite, state };
    }, [operationStorageV2, syncGroupV2]);

    const claimInviteV2 = useCallback(async (inviteLink: string, participantId?: string): Promise<GroupId> => {
        if (!identity) throw new Error('Identity not ready');
        const { invite, state } = await prepareInviteV2(inviteLink);
        if (!state) throw new Error('Group history is not currently available');
        await groupServiceV2.claimInvite(identity.rootKeyPair, inviteLink, participantId);
        await groupServiceV2.authorizeDevice(
            invite.groupId,
            identity.rootKeyPair,
            identity.device.deviceKeyPair.publicKey,
            identity.device.deviceName,
        );
        const access = await operationStorageV2.getGroupAccess(invite.groupId);
        if (!access) throw new Error('Local group access is unavailable');
        await syncGroupV2(access);
        await refreshGroups();
        return invite.groupId as GroupId;
    }, [groupServiceV2, identity, operationStorageV2, prepareInviteV2, refreshGroups, syncGroupV2]);

    const publishGroupV2 = useCallback(async (groupId: GroupId) => {
        const access = await operationStorageV2.getGroupAccess(groupId);
        if (access) await syncGroupV2(access);
        await refreshGroups();
    }, [operationStorageV2, refreshGroups, syncGroupV2]);

    const createExpenseV2 = useCallback(async (groupId: GroupId, expense: ExpenseDataV2) => {
        if (!identity) throw new Error('Identity not ready');
        await groupServiceV2.createExpense(groupId, identity.device.deviceKeyPair, expense);
        await publishGroupV2(groupId);
    }, [groupServiceV2, identity, publishGroupV2]);

    const correctExpenseV2 = useCallback(async (
        groupId: GroupId,
        expenseId: string,
        expense: ExpenseDataV2,
        reason: string,
    ) => {
        if (!identity) throw new Error('Identity not ready');
        await groupServiceV2.correctExpense(groupId, identity.device.deviceKeyPair, expenseId, expense, reason);
        await publishGroupV2(groupId);
    }, [groupServiceV2, identity, publishGroupV2]);

    const voidExpenseV2 = useCallback(async (groupId: GroupId, expenseId: string, reason?: string) => {
        if (!identity) throw new Error('Identity not ready');
        await groupServiceV2.voidExpense(groupId, identity.device.deviceKeyPair, expenseId, reason);
        await publishGroupV2(groupId);
    }, [groupServiceV2, identity, publishGroupV2]);

    const createSettlementV2 = useCallback(async (
        groupId: GroupId,
        from: string,
        to: string,
        amountMinorUnits: number,
        currency: string,
    ) => {
        if (!identity) throw new Error('Identity not ready');
        await groupServiceV2.createSettlement(
            groupId,
            identity.device.deviceKeyPair,
            from,
            to,
            amountMinorUnits,
            currency,
        );
        await publishGroupV2(groupId);
    }, [groupServiceV2, identity, publishGroupV2]);

    const renameParticipantV2 = useCallback(async (
        groupId: GroupId,
        participantId: string,
        displayName: string,
    ) => {
        if (!identity) throw new Error('Identity not ready');
        const normalizedName = displayName.trim();
        if (!normalizedName) throw new Error('Participant name is required');
        await groupServiceV2.renameParticipantSlot(groupId, identity.rootKeyPair, participantId, normalizedName);
        await publishGroupV2(groupId);
    }, [groupServiceV2, identity, publishGroupV2]);

    const disableParticipantV2 = useCallback(async (groupId: GroupId, participantId: string) => {
        if (!identity) throw new Error('Identity not ready');
        await groupServiceV2.disableParticipantSlot(groupId, identity.rootKeyPair, participantId, 'Removed by group creator');
        await publishGroupV2(groupId);
    }, [groupServiceV2, identity, publishGroupV2]);

    const resetParticipantV2 = useCallback(async (groupId: GroupId, participantId: string) => {
        if (!identity) throw new Error('Identity not ready');
        await groupServiceV2.resetParticipantSlot(groupId, identity.rootKeyPair, participantId, 'Previous identity was lost');
        await publishGroupV2(groupId);
    }, [groupServiceV2, identity, publishGroupV2]);

    const getAuthorizedDevicesV2 = useCallback(async () => {
        const devices = new Map<string, { name: string; groups: GroupId[] }>();
        if (!identity) return devices;
        for (const groupId of await groupServiceV2.getGroupIds()) {
            const state = await groupServiceV2.getGroupState(groupId);
            if (!state) continue;
            for (const device of Object.values(state.devices)) {
                if (device.ownerRootPublicKey !== identity.rootKeyPair.publicKey || device.status !== 'active') continue;
                const current = devices.get(device.devicePublicKey) ?? { name: device.deviceName, groups: [] };
                current.groups.push(groupId as GroupId);
                devices.set(device.devicePublicKey, current);
            }
        }
        return devices;
    }, [groupServiceV2, identity]);

    const revokeDeviceV2 = useCallback(async (devicePublicKey: string) => {
        if (!identity) throw new Error('Identity not ready');
        const affectedGroups: GroupId[] = [];
        for (const groupId of await groupServiceV2.getGroupIds()) {
            const state = await groupServiceV2.getGroupState(groupId);
            const device = state?.devices[devicePublicKey];
            if (!device || device.ownerRootPublicKey !== identity.rootKeyPair.publicKey || device.status !== 'active') continue;
            await groupServiceV2.revokeDevice(
                groupId,
                identity.rootKeyPair,
                identity.rootKeyPair.publicKey,
                devicePublicKey,
                'Revoked by identity owner',
            );
            affectedGroups.push(groupId as GroupId);
        }
        for (const groupId of affectedGroups) await publishGroupV2(groupId);
    }, [groupServiceV2, identity, publishGroupV2]);

    useEffect(() => {
        if (!identity || !storageReady) return;
        let stopped = false;
        let running = false;

        const synchronizeAll = async () => {
            if (running || stopped) return;
            running = true;
            try {
                let changed = false;
                for (const groupId of await groupServiceV2.getGroupIds()) {
                    if (stopped) return;
                    const access = await operationStorageV2.getGroupAccess(groupId);
                    if (!access) continue;
                    const before = (await groupServiceV2.getOperations(groupId)).length;
                    try {
                        const state = await syncGroupV2(access);
                        if (!state) {
                            setGroupsWaitingForHistory((current) => new Set(current).add(groupId as GroupId));
                            continue;
                        }
                        const ownsParticipant = Object.values(state.participants).some(
                            ({ claimedRootPublicKey, status }) => claimedRootPublicKey === identity.rootKeyPair.publicKey && status === 'claimed',
                        );
                        const currentDevice = state.devices[identity.device.deviceKeyPair.publicKey];
                        if (ownsParticipant && !currentDevice) {
                            await groupServiceV2.authorizeDevice(
                                groupId,
                                identity.rootKeyPair,
                                identity.device.deviceKeyPair.publicKey,
                                identity.device.deviceName,
                            );
                            await syncGroupV2(access);
                            changed = true;
                        }
                        setGroupsWaitingForHistory((current) => {
                            if (!current.has(groupId as GroupId)) return current;
                            const next = new Set(current);
                            next.delete(groupId as GroupId);
                            return next;
                        });
                        changed ||= state.operationCount !== before;
                    } catch {
                        // Offline and unavailable self-hosted relays do not block local group use.
                    }
                }
                if (changed && !stopped) await refreshGroups();
            } finally {
                running = false;
            }
        };

        const synchronizeWhenOnline = () => void synchronizeAll();
        const synchronizeWhenVisible = () => {
            if (document.visibilityState === 'visible') void synchronizeAll();
        };
        window.addEventListener('online', synchronizeWhenOnline);
        document.addEventListener('visibilitychange', synchronizeWhenVisible);
        const interval = window.setInterval(() => void synchronizeAll(), 30_000);
        queueMicrotask(() => void synchronizeAll());
        return () => {
            stopped = true;
            window.clearInterval(interval);
            window.removeEventListener('online', synchronizeWhenOnline);
            document.removeEventListener('visibilitychange', synchronizeWhenVisible);
        };
    }, [groupServiceV2, identity, operationStorageV2, refreshGroups, storageReady, syncGroupV2]);

    // Setup Sync Manager
    useEffect(() => {
        if (!identity) return;
        let active = true;

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
                if (event.type === 'history:missing') {
                    setGroupsWaitingForHistory((current) => new Set(current).add(event.groupId));
                } else if (event.type === 'history:available') {
                    setGroupsWaitingForHistory((current) => {
                        if (!current.has(event.groupId)) return current;
                        const next = new Set(current);
                        next.delete(event.groupId);
                        return next;
                    });
                }
                if (event.type === 'entry:received') {
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
            queueMicrotask(() => {
                if (active) setSyncStatus('connecting');
            });
        } catch {
            queueMicrotask(() => {
                if (active) setSyncStatus('disconnected');
            });
        }

        return () => {
            active = false;
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
            for (const g of groups.filter(({ protocolVersion }) => protocolVersion === 1)) {
                try {
                    const encoder = new TextEncoder();
                    const groupKey = await deriveGroupKey(encoder.encode(g.groupId), g.groupId);
                    transportRef.current?.setGroupCapability(g.groupId, relayCapability(groupKey));
                    syncMgr.registerGroupKey(g.groupId, groupKey);
                    await syncMgr.startSync(g.groupId);
                } catch { /* A later synchronization interval retries this group. */ }
            }
        };
        initGroups();
    }, [groups, identity]);

    // Initial load of groups from manager
    useEffect(() => {
        if (manager && identity) {
            queueMicrotask(() => void refreshGroups());
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
        identityReady,
        manager,
        storage,
        groups,
        refreshGroups,
        getGroupState,
        getGroupEntries,
        getGroupStateV2,
        createParticipantSlotV2,
        createOrReplaceInviteV2,
        createOrReplaceGenericInviteV2,
        prepareInviteV2,
        claimInviteV2,
        createExpenseV2,
        correctExpenseV2,
        voidExpenseV2,
        createSettlementV2,
        renameParticipantV2,
        disableParticipantV2,
        resetParticipantV2,
        getAuthorizedDevicesV2,
        revokeDeviceV2,
        syncStatus,
        groupsWaitingForHistory,
        syncGroupFromRelay,
        broadcastEntry,
        deleteGroup,
        voidExpense,
        correctExpense,
        importIdentity,
        importIdentityFromJson,
        exportIdentityTransferV2,
        createGroup,
        refreshGroup,
        getConnectedGroups,
        lastUpdate,
        personalGroupId,
        persistenceWarning,
        deleteIdentity,
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
