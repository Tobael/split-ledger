/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
    createRootIdentity,
    createDeviceIdentity,
    RelayTransport,
    deriveGroupKey,
    encryptForRelay,
    decryptFromRelay,
    parseInviteV2,
    groupAccessFromInviteV2,
    groupAccessV2Schema,
    signedOperationV2Schema,
    hash,
    type GroupId,
    type Ed25519KeyPair,
    type DeviceIdentity,
    GroupServiceV2,
    createGroupAccessV2,
    type GroupStateV2,
    type GroupAccessV2,
    type InvitePayloadV2,
    type ExpenseDataV2,
} from '@splitledger/core';
import { IndexedDbIdentityStore } from '../storage/IndexedDbIdentityStore';
import { IndexedDbOperationStorageV2 } from '../storage/IndexedDbOperationStorageV2';
import { BrowserDeviceInfo } from '../platform/BrowserDeviceInfo';
import { BrowserRelaySettings } from '../platform/BrowserRelaySettings';

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
}

type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface AppContextValue {
    // Identity
    identity: IdentityState | null;
    createIdentity: (displayName: string) => Promise<void>;
    updateIdentity: (updated: IdentityState) => Promise<void>;
    isOnboarded: boolean;
    identityReady: boolean;

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
    const relaySettings = useMemo(() => new BrowserRelaySettings(import.meta.env.VITE_RELAY_URL as string | undefined), []);
    const [identity, setIdentity] = useState<IdentityState | null>(null);
    const [identityReady, setIdentityReady] = useState(false);
    const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
    const [groups, setGroups] = useState<GroupSummary[]>([]);
    const [lastUpdate, setLastUpdate] = useState(0);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
    const [groupsWaitingForHistory, setGroupsWaitingForHistory] = useState<Set<GroupId>>(() => new Set());
    const [storageReady, setStorageReady] = useState(false);
    const [preferredRelayUrl, setPreferredRelayUrlState] = useState(() => relaySettings.preferredRelayUrl());

    const identityStore = useMemo(() => new IndexedDbIdentityStore(), []);
    const operationStorageV2 = useMemo(() => new IndexedDbOperationStorageV2(), []);
    const groupServiceV2 = useMemo(() => new GroupServiceV2(operationStorageV2), [operationStorageV2]);
    const deviceInfo = useMemo(() => new BrowserDeviceInfo(), []);

    const syncGroupV2 = useCallback(async (access: GroupAccessV2): Promise<GroupStateV2 | null> => {
        const groupId = access.groupId as GroupId;
        const transport = new RelayTransport({
            url: relayWebSocketUrl(access.relayUrl),
            groupCapabilities: { [access.groupId]: access.relayGroupCapability },
        });
        const groupKey = deriveGroupKey(base64UrlToBytes(access.groupSecret), groupId);
        setSyncStatus('connecting');
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
                    && !operations.some(({ payload }) => payload.type === 'GroupCreated')) {
                    setSyncStatus('connected');
                    return null;
                }
                try {
                    await groupServiceV2.acceptOperations(access.groupId, operations);
                } catch (error) {
                    if (error instanceof Error && error.message.startsWith('Missing protocol v2 parent:')) {
                        const partialState = await groupServiceV2.getGroupState(access.groupId);
                        setSyncStatus('connected');
                        return partialState;
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
            const state = await groupServiceV2.getGroupState(access.groupId);
            setSyncStatus('connected');
            return state;
        } catch (error) {
            setSyncStatus('disconnected');
            throw error;
        } finally {
            await transport.disconnectAll();
        }
    }, [groupServiceV2]);

    // Load persisted group entries on mount
    useEffect(() => {
        const initializeStorage = async () => {
            const root = await identityStore.getRootIdentity();
            const device = await identityStore.getDeviceIdentity();

            if (root && device) {
                setIdentity({ displayName: root.displayName, rootKeyPair: root.rootKeyPair, device });
            }
            setStorageReady(true);
            setIdentityReady(true);
        };

        initializeStorage()
            .catch(() => {
                setPersistenceWarning('Identity or ledger storage could not be opened.');
                setIdentityReady(true);
            });
    }, [identityStore]);

    const persistIdentity = useCallback(async (nextIdentity: IdentityState) => {
        await identityStore.storeRootIdentity({
            rootKeyPair: nextIdentity.rootKeyPair,
            displayName: nextIdentity.displayName,
            createdAt: Date.now(),
        });
        await identityStore.storeDeviceIdentity(nextIdentity.device);
        setIdentity(nextIdentity);
    }, [identityStore]);

    const setPreferredRelayUrl = useCallback((value: string) => {
        const normalized = relaySettings.savePreferredRelayUrl(value);
        setPreferredRelayUrlState(normalized);
    }, [relaySettings]);

    const refreshGroups = useCallback(async () => {
        if (!identity) return;
        const summaries: GroupSummary[] = [];
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
            });
        }
        setGroups(summaries);
        setLastUpdate(Date.now());
    }, [groupServiceV2, identity]);

    const createGroup = useCallback(async (name: string, currency: string) => {
        if (!identity) throw new Error('Identity not ready');

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
            void syncGroupV2(access).catch(() => {
                // The group remains fully usable offline and will be republished later.
            });

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
    }, [identity, preferredRelayUrl, refreshGroups, groupServiceV2, operationStorageV2, syncGroupV2]);



    const deleteGroup = useCallback(async (groupId: GroupId) => {
        await groupServiceV2.deleteGroup(groupId);
        await refreshGroups();
        await operationStorageV2.deleteGroupAccess(groupId);
        setGroupsWaitingForHistory((current) => {
            if (!current.has(groupId)) return current;
            const next = new Set(current);
            next.delete(groupId);
            return next;
        });
    }, [refreshGroups, groupServiceV2, operationStorageV2]);

    const createIdentity = useCallback(async (displayName: string) => {
        const root = createRootIdentity(displayName);
        const device = createDeviceIdentity(root.rootKeyPair, deviceInfo.deviceName(displayName));
        const newIdentity = {
            displayName,
            rootKeyPair: root.rootKeyPair,
            device,
        };
        await persistIdentity(newIdentity);
    }, [deviceInfo, persistIdentity]);

    const importIdentityFromJson = useCallback(async (jsonPayload: string) => {
        const data = JSON.parse(jsonPayload) as IdentityTransferV2;
        if (data.format !== 'fair-money-identity-transfer' || data.version !== 2
            || !data.identity?.rootKeyPair?.publicKey || !data.identity.rootKeyPair.secretKey
            || !data.identity.displayName || !Array.isArray(data.groupAccess)) {
            throw new Error('Invalid identity transfer package');
        }
        const { rootKeyPair, displayName } = data.identity;
        const accesses = data.groupAccess.map((access) => groupAccessV2Schema.parse(access));

        const deviceName = deviceInfo.deviceName(displayName);
        const device = createDeviceIdentity(rootKeyPair, deviceName);
        const newIdentity: IdentityState = { displayName, rootKeyPair, device };

        for (const groupId of await groupServiceV2.getGroupIds()) {
            await groupServiceV2.deleteGroup(groupId);
            await operationStorageV2.deleteGroupAccess(groupId);
        }
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
    }, [deviceInfo, groupServiceV2, operationStorageV2, persistIdentity, refreshGroups, syncGroupV2]);

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

    const updateIdentity = useCallback(async (updated: IdentityState) => {
        await persistIdentity(updated);
    }, [persistIdentity]);

    const deleteIdentity = useCallback(async () => {
        for (const groupId of await groupServiceV2.getGroupIds()) {
            await groupServiceV2.deleteGroup(groupId);
            await operationStorageV2.deleteGroupAccess(groupId);
        }
        await identityStore.clearIdentity();
        setIdentity(null);
        setGroups([]);
        setGroupsWaitingForHistory(new Set());
        setSyncStatus('disconnected');
    }, [groupServiceV2, identityStore, operationStorageV2]);

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
            joinBaseUrl: relaySettings.joinBaseUrl(),
            relayUrl: access.relayUrl,
            relayGroupCapability: access.relayGroupCapability,
            groupSecret: access.groupSecret,
        });
        await syncGroupV2(access);
        setLastUpdate(Date.now());
        return issued.invite.url;
    }, [groupServiceV2, identity, operationStorageV2, relaySettings, syncGroupV2]);

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
            joinBaseUrl: relaySettings.joinBaseUrl(),
            relayUrl: access.relayUrl,
            relayGroupCapability: access.relayGroupCapability,
            groupSecret: access.groupSecret,
        });
        await syncGroupV2(access);
        setLastUpdate(Date.now());
        return issued.invite.url;
    }, [groupServiceV2, identity, operationStorageV2, relaySettings, syncGroupV2]);

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

    useEffect(() => {
        if (identity) queueMicrotask(() => void refreshGroups());
    }, [identity, refreshGroups]);

    const value: AppContextValue = {
        identity,
        createIdentity,
        updateIdentity,
        isOnboarded: identity !== null,
        identityReady,
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
    } as AppContextValue;

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ─── Hook ───

export function useApp(): AppContextValue {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used within AppProvider');
    return ctx;
}
