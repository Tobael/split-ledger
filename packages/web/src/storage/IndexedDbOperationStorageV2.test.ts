import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

import {
    createGroupCommandV2,
    createGroupAccessV2,
    GroupServiceV2,
    createParticipantSlotCommandV2,
    generateKeyPair,
} from '@splitledger/core';
import { IndexedDbOperationStorageV2 } from './IndexedDbOperationStorageV2';

const databases: string[] = [];
const storages: IndexedDbOperationStorageV2[] = [];

afterEach(async () => {
    await Promise.all(storages.splice(0).map((storage) => storage.close()));
    await Promise.all(databases.splice(0).map((name) => new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    })));
});

describe('IndexedDbOperationStorageV2', () => {
    it('implements isolated, idempotent protocol-v2 operation-set persistence', async () => {
        const databaseName = `fair-money-v2-test-${crypto.randomUUID()}`;
        databases.push(databaseName);
        const storage = new IndexedDbOperationStorageV2(databaseName);
        storages.push(storage);
        const creator = generateKeyPair();
        const root = createGroupCommandV2({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator,
            groupId: '018cc251-f400-7000-8000-000000000001',
            creatorParticipantId: '018cc251-f400-7000-8000-000000000002',
        });
        const slot = createParticipantSlotCommandV2(
            { history: [root], actor: creator },
            'Bob', '018cc251-f400-7000-8000-000000000003',
        );

        await storage.putOperation(root);
        await storage.putOperation(slot);
        const access = createGroupAccessV2(root.groupId, 'wss://relay.example/ws');
        await storage.storeGroupAccess(access);
        await storage.putOperation(slot);

        expect(await storage.getOperation(root.operationId)).toEqual(root);
        expect(await storage.getOperations(root.groupId)).toEqual([root, slot]);
        expect(await storage.getGroupIds()).toEqual([root.groupId]);
        expect(await storage.getGroupAccess(root.groupId)).toEqual(access);
        await storage.deleteGroup(root.groupId);
        expect(await storage.getOperation(root.operationId)).toBeNull();
        expect(await storage.getGroupIds()).toEqual([]);
        expect(await storage.getGroupAccess(root.groupId)).toBeNull();
    });

    it('rejects malformed operations before writing', async () => {
        const databaseName = `fair-money-v2-test-${crypto.randomUUID()}`;
        databases.push(databaseName);
        const storage = new IndexedDbOperationStorageV2(databaseName);
        storages.push(storage);
        await expect(storage.putOperation({ operationId: 'invalid' } as never)).rejects.toThrow();
        await expect(storage.storeGroupAccess({ groupId: 'invalid' } as never)).rejects.toThrow();
    });

    it('reloads a service-projected group and its access material', async () => {
        const databaseName = `fair-money-v2-test-${crypto.randomUUID()}`;
        databases.push(databaseName);
        const firstStorage = new IndexedDbOperationStorageV2(databaseName);
        storages.push(firstStorage);
        const service = new GroupServiceV2(firstStorage);
        const creator = generateKeyPair();
        const state = await service.createGroup({
            groupName: 'Reloaded trip', creatorDisplayName: 'Alice', creator,
            groupId: '018cc251-f400-7000-8000-000000000001',
            creatorParticipantId: '018cc251-f400-7000-8000-000000000002',
        });
        const access = createGroupAccessV2(state.groupId, 'wss://relay.example/ws');
        await firstStorage.storeGroupAccess(access);
        await firstStorage.close();

        const reopenedStorage = new IndexedDbOperationStorageV2(databaseName);
        storages.push(reopenedStorage);
        const reopenedService = new GroupServiceV2(reopenedStorage);

        expect(await reopenedService.getGroupState(state.groupId)).toEqual(state);
        expect(await reopenedStorage.getGroupAccess(state.groupId)).toEqual(access);
    });
});
