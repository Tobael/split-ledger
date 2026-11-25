import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
    createDeviceIdentity, createGroupAccessV2, createRootIdentity, GroupServiceV2, IdentitySyncService,
    parseIdentityDirectoryRecord, signIdentityDirectoryRecord, projectIdentityDirectory, exchangeEncryptedSet,
    type GroupAccessV2, type SyncIdentity,
} from '@splitledger/core';
import { IndexedDbOperationStorageV2 } from '../storage/IndexedDbOperationStorageV2';
import { EncryptedRelay } from '../test/EncryptedRelay';
import { exportIdentitySnapshot, importIdentitySnapshot } from './identity-transfer';

const storages: IndexedDbOperationStorageV2[] = [];
const databases: string[] = [];
function storage() {
    const name = `identity-sync-${crypto.randomUUID()}`;
    databases.push(name);
    const value = new IndexedDbOperationStorageV2(name);
    storages.push(value);
    return value;
}
afterEach(async () => {
    await Promise.all(storages.splice(0).map((value) => value.close()));
    await Promise.all(databases.splice(0).map((name) => new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    })));
});
async function devices() {
    const source = storage();
    const root = createRootIdentity('Alice');
    const identity = { ...root, device: createDeviceIdentity(root.rootKeyPair, 'Phone'), directoryAccess: createGroupAccessV2(crypto.randomUUID(), 'wss://directory.example/ws') };
    const sourceSync = new IdentitySyncService(source, identity);
    await sourceSync.registerDevice();
    const target = storage();
    const browser = await importIdentitySnapshot(await exportIdentitySnapshot(identity, source), 'Browser', target);
    return { source, target, identity, browser, sourceSync, targetSync: new IdentitySyncService(target, browser), relay: new EncryptedRelay() };
}
async function group(store: IndexedDbOperationStorageV2, identity: SyncIdentity, name: string) {
    const service = new GroupServiceV2(store);
    const state = await service.createGroup({ groupName: name, creatorDisplayName: 'Alice', creator: identity.rootKeyPair });
    await service.authorizeDevice(state.groupId, identity.rootKeyPair, identity.device.deviceKeyPair.publicKey, identity.device.deviceName);
    const access = createGroupAccessV2(state.groupId, 'wss://groups.example/ws');
    await store.storeGroupAccess(access);
    return { service, state, access };
}

describe('automatic identity group discovery', () => {
    it('discovers groups created after transfer in both directions and permits concurrent editing', async () => {
        const d = await devices();
        const first = await group(d.source, d.identity, 'New on phone');
        expect((await d.sourceSync.synchronize(d.relay.transport)).errors.size).toBe(0);
        expect((await d.targetSync.synchronize(d.relay.transport)).errors.size).toBe(0);
        const second = await group(d.target, d.browser, 'New in browser');
        await d.targetSync.synchronize(d.relay.transport);
        await d.sourceSync.synchronize(d.relay.transport);
        expect(await d.target.getGroupIds()).toEqual([...await d.source.getGroupIds()].sort());
        expect(await d.source.getGroupAccess(second.state.groupId)).toEqual(second.access);
        const browserService = new GroupServiceV2(d.target);
        const expense = { description: 'Lunch', amountMinorUnits: 300, currency: 'EUR', paidBy: first.state.creatorParticipantId, splits: { [first.state.creatorParticipantId]: 300 } };
        const created = await first.service.createExpense(first.state.groupId, d.identity.device.deviceKeyPair, expense);
        await browserService.createExpense(first.state.groupId, d.browser.device.deviceKeyPair, { ...expense, description: 'Dinner' });
        await d.sourceSync.synchronize(d.relay.transport);
        await d.targetSync.synchronize(d.relay.transport);
        await d.sourceSync.synchronize(d.relay.transport);
        if (created.payload.type !== 'ExpenseCreated') throw new Error('Expected expense');
        await browserService.correctExpense(first.state.groupId, d.browser.device.deviceKeyPair, created.payload.expenseId, { ...expense, description: 'Corrected lunch' }, 'Correction');
        await d.targetSync.synchronize(d.relay.transport);
        await d.sourceSync.synchronize(d.relay.transport);
        expect(await first.service.getGroupState(first.state.groupId)).toEqual(await browserService.getGroupState(first.state.groupId));
        // Directory is separate from product groups and contains ciphertext only on the relay.
        expect(await d.source.getGroupIds()).not.toContain(d.identity.directoryAccess.groupId);
        expect(JSON.stringify([...d.relay.namespaces.values()].map((records) => [...records.values()]))).not.toContain('New on phone');
        expect(JSON.stringify([...d.relay.namespaces.values()].map((records) => [...records.values()]))).not.toContain(first.access.groupSecret);
    });

    it('rebuilds an empty relay and heals missing parents instead of starving republication', async () => {
        const d = await devices();
        const first = await group(d.source, d.identity, 'Pruned trip');
        await d.sourceSync.synchronize(d.relay.transport);
        const root = (await d.source.getOperations(first.state.groupId)).find(({ payload }) => payload.type === 'GroupCreated')!;
        d.relay.namespaces.get(first.state.groupId)!.delete(root.operationId);
        const incomplete = await d.targetSync.synchronize(d.relay.transport);
        expect(incomplete.waitingForHistory.has(first.state.groupId)).toBe(true);
        expect(await d.target.getGroupAccess(first.state.groupId)).toEqual(first.access);
        expect(await d.target.getOperations(first.state.groupId)).toHaveLength(0);
        expect((await d.sourceSync.synchronize(d.relay.transport)).errors.size).toBe(0);
        expect((await d.targetSync.synchronize(d.relay.transport)).waitingForHistory.size).toBe(0);
        d.relay.namespaces.clear();
        expect((await d.targetSync.synchronize(d.relay.transport)).errors.size).toBe(0);
        const phoneState = await first.service.getGroupState(first.state.groupId);
        await d.sourceSync.synchronize(d.relay.transport);
        expect((await first.service.getGroupState(first.state.groupId))!.operationCount).toBeGreaterThanOrEqual(phoneState!.operationCount);
        expect(d.relay.namespaces.get(d.identity.directoryAccess.groupId)!.size).toBeGreaterThan(0);
        expect(d.relay.namespaces.get(first.state.groupId)!.size).toBeGreaterThan(0);
    });

    it('preserves local deletion across discovery, restart, and relay loss', async () => {
        const d = await devices();
        const first = await group(d.source, d.identity, 'Hidden locally');
        await d.sourceSync.synchronize(d.relay.transport);
        await d.targetSync.synchronize(d.relay.transport);
        await d.target.deleteGroup(first.state.groupId);
        await new IdentitySyncService(d.target, d.browser).synchronize(d.relay.transport);
        expect(await d.target.getGroupIds()).not.toContain(first.state.groupId);
        expect(await d.source.getGroupIds()).toContain(first.state.groupId);
        d.relay.namespaces.clear();
        await d.sourceSync.synchronize(d.relay.transport);
        await d.targetSync.synchronize(d.relay.transport);
        expect(await d.target.getGroupIds()).not.toContain(first.state.groupId);
    });

    it('propagates offline revocation to groups unknown to the revoking session and never reenrolls the old key', async () => {
        const d = await devices();
        const first = await group(d.source, d.identity, 'Shared group');
        await d.sourceSync.synchronize(d.relay.transport);
        await d.targetSync.synchronize(d.relay.transport);
        await d.sourceSync.synchronize(d.relay.transport);
        const second = await group(d.target, d.browser, 'Offline browser group');
        await d.sourceSync.revokeDevice(d.browser.device.deviceKeyPair.publicKey);
        const key = d.browser.device.deviceKeyPair.publicKey;
        expect((await first.service.getGroupState(first.state.groupId))!.devices[key].status).toBe('revoked');
        await d.sourceSync.synchronize(d.relay.transport);
        await d.targetSync.synchronize(d.relay.transport);
        expect(await d.targetSync.isRevoked()).toBe(true);
        expect((await second.service.getGroupState(second.state.groupId))!.devices[key].status).toBe('revoked');
        await d.sourceSync.synchronize(d.relay.transport);
        expect(await d.source.getGroupIds()).toContain(second.state.groupId);
        const third = await group(d.source, d.identity, 'After revocation');
        await d.sourceSync.synchronize(d.relay.transport);
        await d.targetSync.synchronize(d.relay.transport);
        expect(await d.target.getGroupIds()).not.toContain(third.state.groupId);
        await expect(d.targetSync.revokeDevice(d.identity.device.deviceKeyPair.publicKey)).rejects.toThrow('Current device is revoked');
        const count = (await second.service.getOperations(second.state.groupId)).filter(({ payload }) => payload.type === 'DeviceAuthorized' && payload.devicePublicKey === key).length;
        await d.targetSync.synchronize(d.relay.transport);
        expect((await second.service.getOperations(second.state.groupId)).filter(({ payload }) => payload.type === 'DeviceAuthorized' && payload.devicePublicKey === key)).toHaveLength(count);
    });

    it('continues syncing independent groups when the discovery relay is unavailable and detects dropped writes', async () => {
        const d = await devices();
        const first = await group(d.source, d.identity, 'Independent');
        d.relay.unavailable.add(d.identity.directoryAccess.groupId);
        const result = await d.sourceSync.synchronize(d.relay.transport);
        expect(result.errors.has(d.identity.directoryAccess.groupId)).toBe(true);
        expect(d.relay.namespaces.get(first.state.groupId)!.size).toBeGreaterThan(0);
        d.relay.discardWrites.add(first.state.groupId);
        await first.service.createParticipantSlot(first.state.groupId, d.identity.device.deviceKeyPair, 'Bob');
        expect((await d.sourceSync.synchronize(d.relay.transport)).errors.has(first.state.groupId)).toBe(true);
    });

    it('rejects forged and cross-identity directory records without replacing local access', async () => {
        const d = await devices();
        const root = createRootIdentity('Mallory');
        const forged = signIdentityDirectoryRecord(root.rootKeyPair, d.identity.directoryAccess.groupId, { type: 'DeviceRevoked', devicePublicKey: d.identity.device.deviceKeyPair.publicKey });
        expect(() => parseIdentityDirectoryRecord(forged, d.identity.rootKeyPair.publicKey, d.identity.directoryAccess.groupId)).toThrow();
        const own = signIdentityDirectoryRecord(d.identity.rootKeyPair, crypto.randomUUID(), forged.payload);
        expect(() => parseIdentityDirectoryRecord(own, d.identity.rootKeyPair.publicKey, d.identity.directoryAccess.groupId)).toThrow();
        await exchangeEncryptedSet({ access: d.identity.directoryAccess, transport: d.relay.transport(d.identity.directoryAccess), local: async () => [forged], id: (record) => record.recordId, parse: (value) => value as typeof forged, accept: async () => {} });
        const result = await d.sourceSync.synchronize(d.relay.transport);
        expect(result.errors.has(d.identity.directoryAccess.groupId)).toBe(true);
        expect(await d.sourceSync.isRevoked()).toBe(false);
        const directory = projectIdentityDirectory(await d.sourceSync.records());
        expect(directory.devices.get(d.identity.device.deviceKeyPair.publicKey)).toBe('Phone');
        const first = await group(d.source, d.identity, 'Preserved access');
        await expect(d.source.storeGroupAccess({ ...first.access, groupSecret: createGroupAccessV2(crypto.randomUUID(), 'wss://relay.example/ws').groupSecret } as GroupAccessV2)).rejects.toThrow('conflicts');
        expect(await d.source.getGroupAccess(first.state.groupId)).toEqual(first.access);
    });
});
