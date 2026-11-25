import { exchangeEncryptedSet } from '../sync/encrypted-set.js';
import type { Transport } from '../sync/transport.js';
import type { DeviceIdentity, Ed25519KeyPair } from '../types.js';
import { GroupServiceV2 } from './group-service.js';
import { synchronizeGroupV2 } from './group-sync.js';
import { parseIdentityDirectoryRecord, projectIdentityDirectory, signIdentityDirectoryRecord, type IdentityDirectoryPayload, type IdentityDirectoryRecord } from './identity-directory.js';
import type { GroupAccessStorageV2, GroupAccessV2, OperationStorageV2 } from './storage.js';

export interface IdentitySyncStorage extends OperationStorageV2, GroupAccessStorageV2 {
    getDirectoryRecords(directoryId: string): Promise<IdentityDirectoryRecord[]>;
    putDirectoryRecords(records: IdentityDirectoryRecord[]): Promise<void>;
    isGroupHidden(groupId: string): Promise<boolean>;
}
export interface SyncIdentity {
    rootKeyPair: Ed25519KeyPair;
    device: DeviceIdentity;
    directoryAccess: GroupAccessV2;
}

/** Identity-private discovery; never a product group or durable relay dependency. */
export class IdentitySyncService {
    private readonly groups: GroupServiceV2;
    constructor(private readonly storage: IdentitySyncStorage, private readonly identity: SyncIdentity) {
        this.groups = new GroupServiceV2(storage);
    }
    async records() {
        return (await this.storage.getDirectoryRecords(this.identity.directoryAccess.groupId)).map((record) =>
            parseIdentityDirectoryRecord(record, this.identity.rootKeyPair.publicKey, this.identity.directoryAccess.groupId));
    }
    async isRevoked() {
        return projectIdentityDirectory(await this.records()).revokedDevices.has(this.identity.device.deviceKeyPair.publicKey);
    }
    private async append(payload: IdentityDirectoryPayload) {
        await this.storage.putDirectoryRecords([signIdentityDirectoryRecord(
            this.identity.rootKeyPair, this.identity.directoryAccess.groupId, payload,
        )]);
    }
    async registerDevice() {
        if (await this.isRevoked()) return;
        await this.append({ type: 'DeviceRegistered', devicePublicKey: this.identity.device.deviceKeyPair.publicKey, deviceName: this.identity.device.deviceName });
    }
    async shareGroup(groupId: string) {
        if (await this.isRevoked() || await this.storage.isGroupHidden(groupId)) return;
        const state = await this.groups.getGroupState(groupId);
        const access = await this.storage.getGroupAccess(groupId);
        if (!state || !access || !Object.values(state.participants).some(({ claimedRootPublicKey, status }) =>
            claimedRootPublicKey === this.identity.rootKeyPair.publicKey && status === 'claimed')) return;
        await this.append({ type: 'GroupShared', access, groupName: state.groupName });
    }
    async revokeDevice(devicePublicKey: string) {
        if (await this.isRevoked()) throw new Error('Current device is revoked');
        const directory = projectIdentityDirectory(await this.records());
        if (!directory.devices.has(devicePublicKey)) throw new Error('Unknown identity device');
        await this.append({ type: 'DeviceRevoked', devicePublicKey });
        await this.applyRevocations();
    }
    private async applyRevocations(onlyGroupId?: string) {
        let changed = false;
        const revoked = projectIdentityDirectory(await this.records()).revokedDevices;
        for (const groupId of onlyGroupId ? [onlyGroupId] : await this.storage.getGroupIds()) {
            const state = await this.groups.getGroupState(groupId);
            if (!state) continue;
            for (const key of revoked) {
                const device = state.devices[key];
                if (device?.ownerRootPublicKey === this.identity.rootKeyPair.publicKey && device.status === 'active') {
                    // Materialize the signed identity-wide decision, including on a revoked session.
                    await this.groups.revokeDevice(groupId, this.identity.rootKeyPair, this.identity.rootKeyPair.publicKey, key, 'Revoked by identity owner');
                    changed = true;
                }
            }
        }
        return changed;
    }
    async synchronize(transportFor?: (access: GroupAccessV2) => Transport) {
        const errors = new Map<string, unknown>();
        const waitingForHistory = new Set<string>();
        await this.registerDevice();
        for (const groupId of await this.storage.getGroupIds()) await this.shareGroup(groupId);
        const access = this.identity.directoryAccess;
        try {
            await exchangeEncryptedSet({
                access, transport: transportFor?.(access),
                local: () => this.records(), id: (record) => record.recordId,
                parse: (value, id) => {
                    const record = parseIdentityDirectoryRecord(value, this.identity.rootKeyPair.publicKey, access.groupId);
                    if (record.recordId !== id) throw new Error('Directory record ID mismatch');
                    return record;
                },
                accept: async (incoming) => {
                    const union = new Map((await this.records()).map((record) => [record.recordId, record]));
                    for (const record of incoming) union.set(record.recordId, record);
                    projectIdentityDirectory([...union.values()]);
                    await this.storage.putDirectoryRecords(incoming);
                },
            });
        } catch (error) { errors.set(access.groupId, error); }
        const directory = projectIdentityDirectory(await this.records());
        const revoked = directory.revokedDevices.has(this.identity.device.deviceKeyPair.publicKey);
        if (!revoked) {
            for (const { access: groupAccess } of directory.groups.values()) {
                if (groupAccess.groupId === access.groupId) continue;
                if (await this.storage.isGroupHidden(groupAccess.groupId)) continue;
                const local = await this.storage.getGroupAccess(groupAccess.groupId);
                if (!local) await this.storage.storeGroupAccess(groupAccess);
                else if (local.groupSecret !== groupAccess.groupSecret || local.relayGroupCapability !== groupAccess.relayGroupCapability || local.relayUrl !== groupAccess.relayUrl) {
                    errors.set(groupAccess.groupId, new Error('Discovered access conflicts with local group access'));
                }
            }
        }
        await this.applyRevocations();
        // One unavailable relay must not prevent independent groups from syncing.
        await Promise.all((await this.storage.getGroupIds()).map(async (groupId) => {
            const groupAccess = await this.storage.getGroupAccess(groupId);
            if (!groupAccess) return;
            try {
                const result = await synchronizeGroupV2(this.groups, groupAccess, transportFor?.(groupAccess));
                if (result.waitingForHistory) waitingForHistory.add(groupId);
                let needsPublication = await this.applyRevocations(groupId);
                const state = result.state;
                const ownsParticipant = state && Object.values(state.participants).some(({ claimedRootPublicKey, status }) =>
                    claimedRootPublicKey === this.identity.rootKeyPair.publicKey && status === 'claimed');
                if (ownsParticipant && !revoked && !state.devices[this.identity.device.deviceKeyPair.publicKey]) {
                    await this.groups.authorizeDevice(groupId, this.identity.rootKeyPair, this.identity.device.deviceKeyPair.publicKey, this.identity.device.deviceName);
                    needsPublication = true;
                }
                if (needsPublication) await synchronizeGroupV2(this.groups, groupAccess, transportFor?.(groupAccess));
            } catch (error) { errors.set(groupId, error); }
        }));
        // A device authorization can arrive in the same round as an identity-wide revocation.
        await this.applyRevocations();
        return { errors, waitingForHistory, revoked };
    }
}
