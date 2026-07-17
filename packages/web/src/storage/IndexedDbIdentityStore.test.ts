import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createDeviceIdentity, createRootIdentity } from '@splitledger/core';
import { IndexedDbIdentityStore } from './IndexedDbIdentityStore';

describe('IndexedDbIdentityStore', () => {
    it('stores, reloads, isolates, and clears root and device identities', async () => {
        const databaseName = `fair-money-identity-test-${crypto.randomUUID()}`;
        const otherDatabaseName = `fair-money-identity-test-${crypto.randomUUID()}`;
        const store = new IndexedDbIdentityStore(databaseName);
        const reopened = new IndexedDbIdentityStore(databaseName);
        const isolated = new IndexedDbIdentityStore(otherDatabaseName);
        const root = createRootIdentity('Alice');
        const device = createDeviceIdentity(root.rootKeyPair, 'Alice phone');

        expect(await store.getRootIdentity()).toBeNull();
        expect(await store.getDeviceIdentity()).toBeNull();
        await store.storeRootIdentity(root);
        await store.storeDeviceIdentity(device);

        expect(await reopened.getRootIdentity()).toEqual(root);
        expect(await reopened.getDeviceIdentity()).toEqual(device);
        expect(await isolated.getRootIdentity()).toBeNull();

        await reopened.clearIdentity();
        expect(await store.getRootIdentity()).toBeNull();
        expect(await store.getDeviceIdentity()).toBeNull();
    });
});
