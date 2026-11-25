import {
    authorizeDeviceCommandV2, createDeviceIdentity, deriveGroupStateV2, parseIdentityTransfer,
    signIdentityDirectoryRecord, parseIdentityDirectoryRecord, projectIdentityDirectory,
    type GroupAccessV2, type DeviceIdentity, type Ed25519KeyPair, type IdentityTransfer,
} from '@splitledger/core';
import type { IndexedDbOperationStorageV2 } from '../storage/IndexedDbOperationStorageV2';

interface TransferIdentity {
    displayName: string;
    rootKeyPair: Ed25519KeyPair;
    device: DeviceIdentity;
    directoryAccess: GroupAccessV2;
}

export async function exportIdentitySnapshot(identity: TransferIdentity, storage: IndexedDbOperationStorageV2): Promise<string> {
    const groups: IdentityTransfer['groups'] = [];
    const directoryRecords = await storage.getDirectoryRecords(identity.directoryAccess.groupId);
    const directory = projectIdentityDirectory(directoryRecords);
    for (const groupId of await storage.getGroupIds()) {
        const access = await storage.getGroupAccess(groupId);
        const operations = await storage.getOperations(groupId);
        if (operations.length === 0) {
            if (directory.groups.has(groupId)) throw new Error('Group history is unavailable; synchronize before exporting');
            continue; // An unclaimed invitation preview is not one of this identity's groups.
        }
        const state = deriveGroupStateV2(operations);
        const ownsParticipant = Object.values(state.participants).some(({ claimedRootPublicKey, status }) =>
            status === 'claimed' && claimedRootPublicKey === identity.rootKeyPair.publicKey);
        if (!ownsParticipant) continue;
        if (!access) throw new Error('Group access is unavailable');
        groups.push({ access, operations });
    }
    return JSON.stringify(parseIdentityTransfer({
        format: 'fair-money-identity-transfer', version: 3,
        identity: { displayName: identity.displayName, rootKeyPair: identity.rootKeyPair, directoryAccess: identity.directoryAccess },
        directoryRecords, groups,
    }));
}

export async function importIdentitySnapshot(json: string, deviceName: string, storage: IndexedDbOperationStorageV2): Promise<TransferIdentity> {
    const transfer = parseIdentityTransfer(JSON.parse(json));
    const rootKeyPair = transfer.identity.rootKeyPair as Ed25519KeyPair;
    const device = createDeviceIdentity(rootKeyPair, deviceName);
    // Enroll locally from the validated snapshot; no relay or source device is required.
    const groups = transfer.groups.map(({ access, operations }) => ({
        access,
        operations: [...operations, authorizeDeviceCommandV2(
            { history: operations, actor: rootKeyPair }, device.deviceKeyPair.publicKey, device.deviceName,
        )],
    }));
    const directoryRecords = transfer.directoryRecords.map((record) => parseIdentityDirectoryRecord(
        record, rootKeyPair.publicKey, transfer.identity.directoryAccess.groupId,
    ));
    directoryRecords.push(signIdentityDirectoryRecord(rootKeyPair, transfer.identity.directoryAccess.groupId, {
        type: 'DeviceRegistered', devicePublicKey: device.deviceKeyPair.publicKey, deviceName,
    }));
    await storage.replaceGroups(groups, directoryRecords, { root: { ...transfer.identity, rootKeyPair, createdAt: Date.now() }, device });
    return { ...transfer.identity, rootKeyPair, device };
}
