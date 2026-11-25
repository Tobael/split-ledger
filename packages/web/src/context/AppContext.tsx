/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
    createRootIdentity,
    createDeviceIdentity,
    parseInviteV2,
    groupAccessFromInviteV2,
    hash,
    type GroupId,
    type Ed25519KeyPair,
    type DeviceIdentity,
    GroupServiceV2,
    createGroupAccessV2,
    IdentitySyncService,
    projectIdentityDirectory,
    synchronizeGroupV2,
    type GroupStateV2,
    type GroupAccessV2,
    type InvitePayloadV2,
    type ExpenseDataV2,
} from '@splitledger/core';
import { IndexedDbOperationStorageV2 } from '../storage/IndexedDbOperationStorageV2';
import { BrowserDeviceInfo } from '../platform/BrowserDeviceInfo';
import { BrowserRelaySettings } from '../platform/BrowserRelaySettings';
import { BrowserSyncLifecycle } from '../platform/BrowserSyncLifecycle';
import { exportIdentitySnapshot, importIdentitySnapshot } from '../utils/identity-transfer';

// ─── Types ───

interface IdentityState {
    displayName: string;
    rootKeyPair: Ed25519KeyPair;
    device: DeviceIdentity;
    directoryAccess: GroupAccessV2;
}

interface GroupSummary {
    groupId: GroupId;
    name: string;
    memberCount: number;
    myBalance: number;
    currency: string;
    waitingForHistory?: boolean;
}

type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface AppContextValue {
    // Identity
    identity: IdentityState | null;
    createIdentity: (displayName: string) => Promise<void>;
    updateIdentity: (updated: IdentityState) => Promise<void>;
    isOnboarded: boolean;
    identityReady: boolean;
    currentDeviceRevoked: boolean;

    // Groups
    groups: GroupSummary[];
    refreshGroups: () => Promise<void>;

    // Group detail helpers
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

    deleteGroup: (groupId: GroupId) => Promise<void>;
    importIdentityFromJson: (jsonPayload: string) => Promise<void>;
    exportIdentityTransferV2: () => Promise<string>;
    createGroup: (name: string, currency: string) => Promise<GroupId>;
    lastUpdate: number;
    persistenceWarning: string | null;
    preferredRelayUrl: string;
    setPreferredRelayUrl: (url: string) => void;
    deleteIdentity: () => Promise<void>;
}

export type { IdentityState };

const AppContext = createContext<AppContextValue | null>(null);

function base64UrlToBytes(value: string): Uint8Array {
    let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

// ─── Provider ───

export function AppProvider({ children }: { children: ReactNode }) {
    const relaySettings = useMemo(() => new BrowserRelaySettings(import.meta.env.VITE_RELAY_URL as string | undefined), []);
    const [identity, setIdentity] = useState<IdentityState | null>(null);
    const [identityReady, setIdentityReady] = useState(false);
    const [currentDeviceRevoked, setCurrentDeviceRevoked] = useState(false);
    const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
    const [groups, setGroups] = useState<GroupSummary[]>([]);
    const [lastUpdate, setLastUpdate] = useState(0);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
    const [groupsWaitingForHistory, setGroupsWaitingForHistory] = useState<Set<GroupId>>(() => new Set());
    const [storageReady, setStorageReady] = useState(false);
    const [preferredRelayUrl, setPreferredRelayUrlState] = useState(() => relaySettings.preferredRelayUrl());

    const operationStorageV2 = useMemo(() => new IndexedDbOperationStorageV2(), []);
    const groupServiceV2 = useMemo(() => new GroupServiceV2(operationStorageV2), [operationStorageV2]);
    const deviceInfo = useMemo(() => new BrowserDeviceInfo(), []);
    const syncLifecycle = useMemo(() => new BrowserSyncLifecycle(), []);

    const activeSyncs = useRef(new Set<Promise<unknown>>());
    const syncAgain = useRef(false);
    const fullSync = useRef<Promise<void> | null>(null);
    const identitySyncService = useMemo(() => identity ? new IdentitySyncService(operationStorageV2, identity) : null, [identity, operationStorageV2]);
    const transferInProgress = useRef(false);

    const performGroupSyncV2 = useCallback(async (access: GroupAccessV2): Promise<GroupStateV2 | null> => {
        setSyncStatus('connecting');
        try {
            const result = await synchronizeGroupV2(groupServiceV2, access);
            setGroupsWaitingForHistory((current) => {
                const next = new Set(current);
                if (result.waitingForHistory) next.add(access.groupId as GroupId);
                else next.delete(access.groupId as GroupId);
                return next;
            });
            setSyncStatus('connected');
            return result.state;
        } catch (error) {
            setSyncStatus('disconnected');
            throw error;
        }
    }, [groupServiceV2]);

    const syncGroupV2 = useCallback(async (access: GroupAccessV2) => {
        if (transferInProgress.current) throw new Error('Identity import is in progress');
        const pending = performGroupSyncV2(access);
        activeSyncs.current.add(pending);
        try {
            return await pending;
        } finally {
            activeSyncs.current.delete(pending);
        }
    }, [performGroupSyncV2]);

    // Load persisted group entries on mount
    useEffect(() => {
        const initializeStorage = async () => {
            const stored = await operationStorageV2.loadIdentity();
            const root = stored?.root;
            const device = stored?.device;

            if (root && device) {
                setIdentity({ displayName: root.displayName, rootKeyPair: root.rootKeyPair, directoryAccess: root.directoryAccess, device });
            }
            setStorageReady(true);
            setIdentityReady(true);
        };

        initializeStorage()
            .catch(() => {
                setPersistenceWarning('Identity or ledger storage could not be opened.');
                setIdentityReady(true);
            });
    }, [operationStorageV2]);

    const persistIdentity = useCallback(async (nextIdentity: IdentityState) => {
        await operationStorageV2.saveIdentity({ root: {
            rootKeyPair: nextIdentity.rootKeyPair,
            displayName: nextIdentity.displayName,
            createdAt: Date.now(),
            directoryAccess: nextIdentity.directoryAccess,
        }, device: nextIdentity.device });
        setIdentity(nextIdentity);
    }, [operationStorageV2]);

    const setPreferredRelayUrl = useCallback((value: string) => {
        const normalized = relaySettings.savePreferredRelayUrl(value);
        setPreferredRelayUrlState(normalized);
    }, [relaySettings]);

    const refreshGroups = useCallback(async (currentIdentity = identity) => {
        if (!currentIdentity) return;
        const summaries: GroupSummary[] = [];
        const directory = projectIdentityDirectory(await new IdentitySyncService(operationStorageV2, currentIdentity).records());
        let revoked = await new IdentitySyncService(operationStorageV2, currentIdentity).isRevoked();
        for (const groupId of await groupServiceV2.getGroupIds()) {
            const state = await groupServiceV2.getGroupState(groupId);
            if (!state) {
                const shared = directory.groups.get(groupId);
                if (shared) summaries.push({ groupId: groupId as GroupId, name: shared.groupName, memberCount: 0, myBalance: 0, currency: 'EUR', waitingForHistory: true });
                continue;
            }
            const participant = Object.values(state.participants).find(
                ({ claimedRootPublicKey, status }) => status === 'claimed' && claimedRootPublicKey === currentIdentity.rootKeyPair.publicKey,
            );
            if (!participant) continue;
            revoked ||= state.devices[currentIdentity.device.deviceKeyPair.publicKey]?.status === 'revoked';
            const currency = Object.keys(state.balances).sort()[0] ?? 'EUR';
            summaries.push({
                groupId: groupId as GroupId,
                name: state.groupName,
                memberCount: Object.values(state.participants).filter(({ status }) => status !== 'disabled').length,
                myBalance: state.balances[currency]?.[participant.participantId] ?? 0,
                currency,
            });
        }
        setCurrentDeviceRevoked(revoked);
        setGroups(summaries);
        setLastUpdate(Date.now());
    }, [groupServiceV2, identity, operationStorageV2]);

    const synchronizeIdentityV2 = useCallback(async () => {
        if (!identitySyncService || transferInProgress.current) return;
        if (fullSync.current) {
            syncAgain.current = true;
            return fullSync.current;
        }
        const pending = (async () => {
            do {
                syncAgain.current = false;
                setSyncStatus('connecting');
                try {
                    const result = await identitySyncService.synchronize();
                    if (transferInProgress.current) return;
                    setGroupsWaitingForHistory(new Set([...result.waitingForHistory] as GroupId[]));
                    setSyncStatus(result.errors.size ? 'disconnected' : 'connected');
                    await refreshGroups();
                } catch {
                    setSyncStatus('disconnected');
                }
            } while (syncAgain.current && !transferInProgress.current);
        })();
        fullSync.current = pending;
        activeSyncs.current.add(pending);
        try { await pending; }
        finally {
            activeSyncs.current.delete(pending);
            fullSync.current = null;
        }
    }, [identitySyncService, refreshGroups]);

    const createGroup = useCallback(async (name: string, currency: string) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');

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
            const access = createGroupAccessV2(groupId, preferredRelayUrl);
            await operationStorageV2.storeGroupAccess(access);
            await identitySyncService?.shareGroup(groupId);
            void synchronizeIdentityV2();

            const newGroupSummary: GroupSummary = {
                groupId,
                name,
                memberCount: 1,
                myBalance: 0,
                currency,
            };

            setGroups(prev => [newGroupSummary, ...prev]);

            await refreshGroups();

            return groupId;
        } catch (e) {
            console.error('Failed to create group', e);
            throw e;
        }
    }, [identity, preferredRelayUrl, refreshGroups, groupServiceV2, operationStorageV2, identitySyncService, synchronizeIdentityV2]);



    const deleteGroup = useCallback(async (groupId: GroupId) => {
        transferInProgress.current = true;
        try {
            await Promise.allSettled([...activeSyncs.current]);
            await groupServiceV2.deleteGroup(groupId);
            await refreshGroups();
            setGroupsWaitingForHistory((current) => {
                const next = new Set(current);
                next.delete(groupId);
                return next;
            });
        } finally { transferInProgress.current = false; }
    }, [refreshGroups, groupServiceV2]);

    const createIdentity = useCallback(async (displayName: string) => {
        const root = createRootIdentity(displayName);
        const device = createDeviceIdentity(root.rootKeyPair, deviceInfo.deviceName(displayName));
        const newIdentity = {
            displayName,
            rootKeyPair: root.rootKeyPair,
            device,
            directoryAccess: createGroupAccessV2(crypto.randomUUID(), preferredRelayUrl),
        };
        await new IdentitySyncService(operationStorageV2, newIdentity).registerDevice();
        await persistIdentity(newIdentity);
    }, [deviceInfo, persistIdentity, preferredRelayUrl, operationStorageV2]);

    const importIdentityFromJson = useCallback(async (jsonPayload: string) => {
        transferInProgress.current = true;
        let newIdentity: IdentityState;
        try {
            // Finish old-identity requests before atomically replacing local state.
            await Promise.allSettled([...activeSyncs.current]);
            newIdentity = await importIdentitySnapshot(
                jsonPayload, deviceInfo.deviceName('Fair Money'), operationStorageV2,
            );
            setGroupsWaitingForHistory(new Set());
            await refreshGroups(newIdentity);
        } finally {
            transferInProgress.current = false;
        }
        // Activate the new session only after lifting the import gate, so its initial sync runs.
        setIdentity(newIdentity);
    }, [deviceInfo, operationStorageV2, refreshGroups]);

    const exportIdentityTransferV2 = useCallback(async () => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        return exportIdentitySnapshot(identity, operationStorageV2);
    }, [identity, operationStorageV2, identitySyncService]);

    const updateIdentity = useCallback(async (updated: IdentityState) => {
        await persistIdentity(updated);
    }, [persistIdentity]);

    const deleteIdentity = useCallback(async () => {
        transferInProgress.current = true;
        try {
            await Promise.allSettled([...activeSyncs.current]);
            await operationStorageV2.replaceGroups([], [], null);
            setIdentity(null);
            setGroups([]);
            setCurrentDeviceRevoked(false);
            setGroupsWaitingForHistory(new Set());
            setSyncStatus('disconnected');
        } finally { transferInProgress.current = false; }
    }, [operationStorageV2]);

    const getGroupStateV2 = useCallback(async (groupId: GroupId) => {
        return groupServiceV2.getGroupState(groupId);
    }, [groupServiceV2]);

    const createParticipantSlotV2 = useCallback(async (groupId: GroupId, displayName: string) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        const normalizedName = displayName.trim();
        if (!normalizedName) throw new Error('Participant name is required');
        await groupServiceV2.createParticipantSlot(groupId, identity.device.deviceKeyPair, normalizedName);
        await refreshGroups();
        void synchronizeIdentityV2();
    }, [groupServiceV2, identity, refreshGroups, identitySyncService, synchronizeIdentityV2]);

    const createOrReplaceInviteV2 = useCallback(async (groupId: GroupId, participantId: string) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
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
                await groupServiceV2.revokeInvite(groupId, identity.device.deviceKeyPair, capability.capabilityId);
            }
        }
        const issued = await groupServiceV2.issueInviteForGroup(groupId, {
            actor: identity.device.deviceKeyPair,
            participantId,
            joinBaseUrl: relaySettings.joinBaseUrl(),
            relayUrl: access.relayUrl,
            relayGroupCapability: access.relayGroupCapability,
            groupSecret: access.groupSecret,
        });
        setLastUpdate(Date.now());
        void synchronizeIdentityV2();
        return issued.invite.url;
    }, [groupServiceV2, identity, operationStorageV2, relaySettings, synchronizeIdentityV2, identitySyncService]);

    const createOrReplaceGenericInviteV2 = useCallback(async (groupId: GroupId) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
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
                await groupServiceV2.revokeInvite(groupId, identity.device.deviceKeyPair, capability.capabilityId);
            }
        }
        const issued = await groupServiceV2.issueInviteForGroup(groupId, {
            actor: identity.device.deviceKeyPair,
            scope: 'any-unclaimed-slot',
            joinBaseUrl: relaySettings.joinBaseUrl(),
            relayUrl: access.relayUrl,
            relayGroupCapability: access.relayGroupCapability,
            groupSecret: access.groupSecret,
        });
        setLastUpdate(Date.now());
        void synchronizeIdentityV2();
        return issued.invite.url;
    }, [groupServiceV2, identity, operationStorageV2, relaySettings, synchronizeIdentityV2, identitySyncService]);

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
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
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
        await identitySyncService?.shareGroup(invite.groupId);
        await refreshGroups();
        void synchronizeIdentityV2();
        return invite.groupId as GroupId;
    }, [groupServiceV2, identity, operationStorageV2, prepareInviteV2, refreshGroups, identitySyncService, synchronizeIdentityV2]);

    const publishGroupV2 = useCallback(async () => {
        await refreshGroups();
        void synchronizeIdentityV2();
    }, [refreshGroups, synchronizeIdentityV2]);

    const createExpenseV2 = useCallback(async (groupId: GroupId, expense: ExpenseDataV2) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        await groupServiceV2.createExpense(groupId, identity.device.deviceKeyPair, expense);
        await publishGroupV2();
    }, [groupServiceV2, identity, publishGroupV2, identitySyncService]);

    const correctExpenseV2 = useCallback(async (
        groupId: GroupId,
        expenseId: string,
        expense: ExpenseDataV2,
        reason: string,
    ) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        await groupServiceV2.correctExpense(groupId, identity.device.deviceKeyPair, expenseId, expense, reason);
        await publishGroupV2();
    }, [groupServiceV2, identity, publishGroupV2, identitySyncService]);

    const voidExpenseV2 = useCallback(async (groupId: GroupId, expenseId: string, reason?: string) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        await groupServiceV2.voidExpense(groupId, identity.device.deviceKeyPair, expenseId, reason);
        await publishGroupV2();
    }, [groupServiceV2, identity, publishGroupV2, identitySyncService]);

    const createSettlementV2 = useCallback(async (
        groupId: GroupId,
        from: string,
        to: string,
        amountMinorUnits: number,
        currency: string,
    ) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        await groupServiceV2.createSettlement(
            groupId,
            identity.device.deviceKeyPair,
            from,
            to,
            amountMinorUnits,
            currency,
        );
        await publishGroupV2();
    }, [groupServiceV2, identity, publishGroupV2, identitySyncService]);

    const renameParticipantV2 = useCallback(async (
        groupId: GroupId,
        participantId: string,
        displayName: string,
    ) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        const normalizedName = displayName.trim();
        if (!normalizedName) throw new Error('Participant name is required');
        await groupServiceV2.renameParticipantSlot(groupId, identity.device.deviceKeyPair, participantId, normalizedName);
        await publishGroupV2();
    }, [groupServiceV2, identity, publishGroupV2, identitySyncService]);

    const disableParticipantV2 = useCallback(async (groupId: GroupId, participantId: string) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        await groupServiceV2.disableParticipantSlot(groupId, identity.device.deviceKeyPair, participantId, 'Removed by group creator');
        await publishGroupV2();
    }, [groupServiceV2, identity, publishGroupV2, identitySyncService]);

    const resetParticipantV2 = useCallback(async (groupId: GroupId, participantId: string) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        await groupServiceV2.resetParticipantSlot(groupId, identity.device.deviceKeyPair, participantId, 'Previous identity was lost');
        await publishGroupV2();
    }, [groupServiceV2, identity, publishGroupV2, identitySyncService]);

    const getAuthorizedDevicesV2 = useCallback(async () => {
        const devices = new Map<string, { name: string; groups: GroupId[] }>();
        if (!identity || !identitySyncService) return devices;
        const directory = projectIdentityDirectory(await identitySyncService.records());
        for (const [key, name] of directory.devices) {
            if (!directory.revokedDevices.has(key)) devices.set(key, { name, groups: [] });
        }
        for (const groupId of await groupServiceV2.getGroupIds()) {
            const state = await groupServiceV2.getGroupState(groupId);
            if (!state) continue;
            for (const device of Object.values(state.devices)) {
                if (device.ownerRootPublicKey !== identity.rootKeyPair.publicKey || device.status !== 'active' || directory.revokedDevices.has(device.devicePublicKey)) continue;
                const current = devices.get(device.devicePublicKey) ?? { name: device.deviceName, groups: [] };
                current.groups.push(groupId as GroupId);
                devices.set(device.devicePublicKey, current);
            }
        }
        return devices;
    }, [groupServiceV2, identity, identitySyncService]);

    const revokeDeviceV2 = useCallback(async (devicePublicKey: string) => {
        if (!identity) throw new Error('Identity not ready');
        if (await identitySyncService?.isRevoked()) throw new Error('Current device is revoked');
        await identitySyncService?.revokeDevice(devicePublicKey);
        await refreshGroups();
        void synchronizeIdentityV2();
    }, [identity, identitySyncService, refreshGroups, synchronizeIdentityV2]);

    useEffect(() => {
        if (!identity || !storageReady) return;
        return syncLifecycle.subscribe(() => void synchronizeIdentityV2());
    }, [identity, storageReady, syncLifecycle, synchronizeIdentityV2]);

    useEffect(() => {
        if (identity) queueMicrotask(() => void refreshGroups());
    }, [identity, refreshGroups]);

    const value: AppContextValue = {
        identity,
        createIdentity,
        updateIdentity,
        isOnboarded: identity !== null,
        identityReady,
        currentDeviceRevoked,
        groups,
        refreshGroups,
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
        deleteGroup,
        importIdentityFromJson,
        exportIdentityTransferV2,
        createGroup,
        lastUpdate,
        persistenceWarning,
        preferredRelayUrl,
        setPreferredRelayUrl,
        deleteIdentity,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ─── Hook ───

export function useApp(): AppContextValue {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used within AppProvider');
    return ctx;
}
