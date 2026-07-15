import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
    EntryType,
    buildEntry,
    createDeviceIdentity,
    createRootIdentity,
    generateGroupId,
    type GroupState,
} from '@splitledger/core';
import { IndexedDbStorageAdapter } from './IndexedDbStorageAdapter';

describe('IndexedDbStorageAdapter', () => {
    it('persists entries, state, and identities and deletes one group atomically', async () => {
        const storage = new IndexedDbStorageAdapter(`fair-money-test-${crypto.randomUUID()}`);
        const root = createRootIdentity('Alice');
        const device = createDeviceIdentity(root.rootKeyPair, 'Browser');
        const groupId = generateGroupId();
        const otherGroupId = generateGroupId();
        const genesis = buildEntry(
            EntryType.Genesis,
            {
                groupId,
                groupName: 'Trip',
                creatorRootPubkey: root.rootKeyPair.publicKey,
                creatorDisplayName: 'Alice',
            },
            null,
            0,
            device.deviceKeyPair.publicKey,
            device.deviceKeyPair.secretKey,
            1000,
        );
        const expense = buildEntry(
            EntryType.ExpenseCreated,
            {
                description: 'Dinner',
                amountMinorUnits: 1200,
                currency: 'EUR',
                paidByRootPubkey: root.rootKeyPair.publicKey,
                splits: { [root.rootKeyPair.publicKey]: 1200 },
            },
            genesis.entryId,
            1,
            device.deviceKeyPair.publicKey,
            device.deviceKeyPair.secretKey,
            2000,
        );
        const otherGenesis = buildEntry(
            EntryType.Genesis,
            {
                groupId: otherGroupId,
                groupName: 'Other',
                creatorRootPubkey: root.rootKeyPair.publicKey,
                creatorDisplayName: 'Alice',
            },
            null,
            0,
            device.deviceKeyPair.publicKey,
            device.deviceKeyPair.secretKey,
            1001,
        );

        await storage.appendEntry(groupId, expense);
        await storage.appendEntry(groupId, genesis);
        await storage.appendEntry(groupId, genesis);
        await storage.appendEntry(otherGroupId, otherGenesis);

        expect((await storage.getAllEntries(groupId)).map((entry) => entry.entryId)).toEqual([
            genesis.entryId,
            expense.entryId,
        ]);
        expect(await storage.getLatestEntry(groupId)).toEqual(expense);
        expect(await storage.getEntriesAfter(groupId, 0)).toEqual([expense]);
        expect(new Set(await storage.getGroupIds())).toEqual(new Set([groupId, otherGroupId]));

        const state: GroupState = {
            groupId,
            groupName: 'Trip',
            creatorRootPubkey: root.rootKeyPair.publicKey,
            members: new Map([[root.rootKeyPair.publicKey, {
                rootPubkey: root.rootKeyPair.publicKey,
                displayName: 'Alice',
                joinedAt: 1000,
                isActive: true,
                authorizedDevices: new Set([device.deviceKeyPair.publicKey]),
                deviceNames: new Map([[device.deviceKeyPair.publicKey, 'Browser']]),
            }]]),
            latestEntryHash: expense.entryId,
            currentLamportClock: 1,
            balances: new Map([[root.rootKeyPair.publicKey, 0]]),
        };
        await storage.saveGroupState(state);
        await storage.storeRootIdentity(root);
        await storage.storeDeviceIdentity(device);

        expect(await storage.getGroupState(groupId)).toEqual(state);
        expect(await storage.getRootIdentity()).toEqual(root);
        expect(await storage.getDeviceIdentity()).toEqual(device);

        await storage.clearIdentity();
        expect(await storage.getRootIdentity()).toBeNull();
        expect(await storage.getDeviceIdentity()).toBeNull();
        expect(await storage.getAllEntries(groupId)).toHaveLength(2);

        await storage.deleteGroup(groupId);
        expect(await storage.getAllEntries(groupId)).toEqual([]);
        expect(await storage.getGroupState(groupId)).toBeNull();
        expect(await storage.getAllEntries(otherGroupId)).toHaveLength(1);
    });
});
