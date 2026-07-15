import { describe, expect, it } from 'vitest';

import { generateKeyPair } from '../crypto.js';
import {
    createGroupCommandV2,
    createGroupAccessV2,
    groupAccessFromInviteV2,
    InMemoryGroupAccessStorageV2,
    createParticipantSlotCommandV2,
    InMemoryOperationStorageV2,
} from '../protocol-v2/index.js';

describe('protocol v2 operation storage contract', () => {
    it('stores idempotent operation sets by group and deletes one group in isolation', async () => {
        const creator = generateKeyPair();
        const firstRoot = createGroupCommandV2({
            groupName: 'First', creatorDisplayName: 'Alice', creator,
            groupId: '018cc251-f400-7000-8000-000000000001',
            creatorParticipantId: '018cc251-f400-7000-8000-000000000002',
        });
        const slot = createParticipantSlotCommandV2(
            { history: [firstRoot], actor: creator },
            'Bob', '018cc251-f400-7000-8000-000000000003',
        );
        const secondRoot = createGroupCommandV2({
            groupName: 'Second', creatorDisplayName: 'Alice', creator,
            groupId: '018cc251-f400-7000-8000-000000000004',
            creatorParticipantId: '018cc251-f400-7000-8000-000000000005',
        });
        const storage = new InMemoryOperationStorageV2();

        await storage.putOperation(firstRoot);
        await storage.putOperation(slot);
        await storage.putOperation(slot);
        await storage.putOperation(secondRoot);

        expect(await storage.getOperation(slot.operationId)).toEqual(slot);
        expect(await storage.getOperations(firstRoot.groupId)).toHaveLength(2);
        expect(await storage.getGroupIds()).toEqual([firstRoot.groupId, secondRoot.groupId].sort());
        await storage.deleteGroup(firstRoot.groupId);
        expect(await storage.getOperations(firstRoot.groupId)).toEqual([]);
        expect(await storage.getOperations(secondRoot.groupId)).toEqual([secondRoot]);
    });

    it('rejects malformed operations at the storage boundary', async () => {
        const storage = new InMemoryOperationStorageV2();
        await expect(storage.putOperation({ operationId: 'invalid' } as never)).rejects.toThrow();
    });

    it('creates and stores random group access material independently from history', async () => {
        const storage = new InMemoryGroupAccessStorageV2();
        const access = createGroupAccessV2(
            '018cc251-f400-7000-8000-000000000001',
            'wss://relay.example/ws',
        );
        await storage.storeGroupAccess(access);

        expect(await storage.getGroupAccess(access.groupId)).toEqual(access);
        expect(access.groupSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(access.relayGroupCapability).not.toBe(access.groupSecret);
        expect(groupAccessFromInviteV2({ protocolVersion: 2, ...access,
            participantId: '018cc251-f400-7000-8000-000000000002',
            capabilityId: '018cc251-f400-7000-8000-000000000003',
            claimSecret: 'C'.repeat(43), issueOperationId: 'd'.repeat(64),
        })).toEqual(access);
        await storage.deleteGroupAccess(access.groupId);
        expect(await storage.getGroupAccess(access.groupId)).toBeNull();
    });
});
