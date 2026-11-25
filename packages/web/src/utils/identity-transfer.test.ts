import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeviceIdentity, createGroupAccessV2, createRootIdentity, GroupServiceV2, signIdentityDirectoryRecord, type GroupId } from '@splitledger/core';
import { IndexedDbOperationStorageV2 } from '../storage/IndexedDbOperationStorageV2';
import { exportIdentitySnapshot, importIdentitySnapshot } from './identity-transfer';
import { decryptIdentity, encryptIdentity } from './identity-export';

const stores: IndexedDbOperationStorageV2[] = [];
const names: string[] = [];
function session() {
    const name = `transfer-test-${crypto.randomUUID()}`;
    names.push(name);
    const storage = new IndexedDbOperationStorageV2(name);
    stores.push(storage);
    return { storage, service: new GroupServiceV2(storage) };
}
afterEach(async () => {
    await Promise.all(stores.splice(0).map((storage) => storage.close()));
    await Promise.all(names.splice(0).map((name) => new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    })));
});

async function phone() {
    const source = session();
    const root = createRootIdentity('Alice');
    const identity = { ...root, directoryAccess: createGroupAccessV2(crypto.randomUUID(), 'wss://relay.example/ws'), device: createDeviceIdentity(root.rootKeyPair, 'Phone') };
    const groupIds: string[] = [];
    for (const groupName of ['Holiday', 'Household']) {
        const group = await source.service.createGroup({ groupName, creatorDisplayName: 'Alice', creator: root.rootKeyPair });
        groupIds.push(group.groupId);
        await source.service.authorizeDevice(group.groupId, root.rootKeyPair, identity.device.deviceKeyPair.publicKey, 'Phone');
        await source.storage.storeGroupAccess(createGroupAccessV2(group.groupId, 'wss://relay.example/ws'));
    }
    return { ...source, identity, groupIds };
}

describe('identity snapshot transfer across sessions', () => {
    it('encrypts histories larger than the JavaScript argument limit', async () => {
        const history = JSON.stringify({ history: 'x'.repeat(1_000_000) });
        expect(await decryptIdentity(await encryptIdentity(history, 'test-password'), 'test-password')).toBe(history);
    });

    it('imports all groups offline, keeps both sessions editable, converges, and enforces revocation after sync', async () => {
        const source = await phone();
        const target = session();
        const snapshot = await exportIdentitySnapshot(source.identity, source.storage);
        const encrypted = await encryptIdentity(snapshot, 'test-password');
        const browser = await importIdentitySnapshot(await decryptIdentity(encrypted, 'test-password'), 'Browser', target.storage);
        expect((await target.storage.loadIdentity())?.device).toEqual(browser.device);
        expect(browser.rootKeyPair).toEqual(source.identity.rootKeyPair);
        expect(browser.device.deviceKeyPair.publicKey).not.toBe(source.identity.device.deviceKeyPair.publicKey);
        expect(await target.storage.getGroupIds()).toEqual([...source.groupIds].sort());
        expect(await source.storage.getGroupIds()).toEqual([...source.groupIds].sort());
        for (const groupId of source.groupIds) {
            const browserState = (await target.service.getGroupState(groupId))!;
            expect(browserState.devices[browser.device.deviceKeyPair.publicKey].status).toBe('active');
            expect(await target.storage.getGroupAccess(groupId)).toEqual(await source.storage.getGroupAccess(groupId));
            const participantId = browserState.creatorParticipantId;
            const expense = { description: 'Lunch', currency: 'EUR', amountMinorUnits: 100, paidBy: participantId, splits: { [participantId]: 100 } };
            const created = await source.service.createExpense(groupId, source.identity.device.deviceKeyPair, expense);
            await target.service.createExpense(groupId, browser.device.deviceKeyPair, { ...expense, description: 'Dinner' });
            await target.service.acceptOperations(groupId, await source.service.getOperations(groupId));
            await source.service.acceptOperations(groupId, await target.service.getOperations(groupId));
            if (created.payload.type !== 'ExpenseCreated') throw new Error('Expected expense');
            await target.service.correctExpense(groupId, browser.device.deviceKeyPair, created.payload.expenseId, { ...expense, amountMinorUnits: 200, splits: { [participantId]: 200 } }, 'Updated');
            await source.service.acceptOperations(groupId, await target.service.getOperations(groupId));
            expect(await source.service.getGroupState(groupId)).toEqual(await target.service.getGroupState(groupId));
            await source.service.revokeDevice(groupId, source.identity.device.deviceKeyPair, browser.rootKeyPair.publicKey, browser.device.deviceKeyPair.publicKey);
            await target.service.acceptOperations(groupId, await source.service.getOperations(groupId));
            expect((await target.service.getGroupState(groupId))!.devices[browser.device.deviceKeyPair.publicKey].status).toBe('revoked');
            await expect(target.service.createExpense(groupId, browser.device.deviceKeyPair, expense)).rejects.toThrow('authorized active participant device');
            await expect(target.service.createParticipantSlot(groupId, browser.device.deviceKeyPair, 'Bob')).rejects.toThrow('Creator authorization');
            await source.service.createExpense(groupId, source.identity.device.deviceKeyPair, expense);
        }
        // Durable reload includes both history and the fresh authorization.
        const reloaded = new IndexedDbOperationStorageV2(names[1]);
        stores.push(reloaded);
        expect(await reloaded.getOperations(source.groupIds[0])).toEqual(await target.storage.getOperations(source.groupIds[0]));
    });

    it('validates every group and the root key pair before replacing existing data', async () => {
        const source = await phone();
        const target = await phone();
        const snapshot = JSON.parse(await exportIdentitySnapshot(source.identity, source.storage));
        await target.storage.saveIdentity({ root: { displayName: target.identity.displayName, rootKeyPair: target.identity.rootKeyPair, directoryAccess: target.identity.directoryAccess, createdAt: target.identity.createdAt }, device: target.identity.device });
        const previousIdentity = await target.storage.loadIdentity();
        const before = await target.storage.getOperations(target.groupIds[0]);
        const mutations = [
            (data: typeof snapshot) => { data.identity.rootKeyPair.publicKey = target.identity.rootKeyPair.publicKey; },
            (data: typeof snapshot) => { data.groups[1].operations[0].signature = '00'.repeat(64); },
            (data: typeof snapshot) => { data.groups[1].operations.pop(); data.groups[1].operations.shift(); },
            (data: typeof snapshot) => { data.groups[1].access.groupId = crypto.randomUUID() as GroupId; },
            (data: typeof snapshot) => { data.groups.push(data.groups[0]); },
            (data: typeof snapshot) => { data.groups[0].access.relayUrl = 'http://untrusted.example'; },
        ];
        for (const mutate of mutations) {
            const malformed = structuredClone(snapshot);
            mutate(malformed);
            await expect(importIdentitySnapshot(JSON.stringify(malformed), 'Browser', target.storage)).rejects.toThrow();
            expect(await target.storage.getOperations(target.groupIds[0])).toEqual(before);
            expect(await target.storage.loadIdentity()).toEqual(previousIdentity);
        }
    });

    it('retains access-only groups for synchronization retries and refuses an incomplete export', async () => {
        const source = await phone();
        const access = createGroupAccessV2(crypto.randomUUID(), 'wss://relay.example/ws');
        await source.storage.storeGroupAccess(access);
        // Merely previewing an unrelated invitation must not block identity export.
        await expect(exportIdentitySnapshot(source.identity, source.storage)).resolves.toBeTypeOf('string');
        await source.storage.putDirectoryRecords([signIdentityDirectoryRecord(source.identity.rootKeyPair, source.identity.directoryAccess.groupId, { type: 'GroupShared', access, groupName: 'Owned group awaiting history' })]);
        expect(await source.storage.getGroupIds()).toContain(access.groupId);
        await expect(exportIdentitySnapshot(source.identity, source.storage)).rejects.toThrow('history is unavailable');
        await source.storage.deleteGroup(access.groupId);
        expect(await source.storage.getGroupIds()).not.toContain(access.groupId);
    });
});
