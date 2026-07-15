import { describe, expect, it } from 'vitest';

import { generateKeyPair } from '../crypto.js';
import {
    GroupServiceV2,
    InMemoryOperationStorageV2,
} from '../protocol-v2/index.js';

const groupId = '018cc251-f400-7000-8000-000000000001';
const aliceId = '018cc251-f400-7000-8000-000000000002';
const bobId = '018cc251-f400-7000-8000-000000000003';
const firstCapabilityId = '018cc251-f400-7000-8000-000000000004';
const secondCapabilityId = '018cc251-f400-7000-8000-000000000005';

describe('GroupServiceV2', () => {
    it('runs the local participant, reissued invite, device, and expense lifecycle', async () => {
        const storage = new InMemoryOperationStorageV2();
        const service = new GroupServiceV2(storage);
        const aliceRoot = generateKeyPair();
        const aliceDevice = generateKeyPair();
        const bobRoot = generateKeyPair();
        const bobDevice = generateKeyPair();

        await service.createGroup({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator: aliceRoot,
            groupId, creatorParticipantId: aliceId, expenseEditPolicy: 'collaborative',
        });
        await service.authorizeDevice(groupId, aliceRoot, aliceDevice.publicKey, 'Alice phone');
        await service.createParticipantSlot(groupId, aliceRoot, 'Bob', bobId);
        const lostInvite = await service.issueInviteForGroup(groupId, {
            actor: aliceRoot, participantId: bobId, capabilityId: firstCapabilityId,
            joinBaseUrl: 'https://join.example', relayUrl: 'wss://relay.example/ws',
            relayGroupCapability: 'A'.repeat(43), groupSecret: 'B'.repeat(43),
        });
        await service.revokeInvite(groupId, aliceRoot, firstCapabilityId);
        const replacementInvite = await service.issueInviteForGroup(groupId, {
            actor: aliceRoot, participantId: bobId, capabilityId: secondCapabilityId,
            joinBaseUrl: 'https://join.example', relayUrl: 'wss://relay.example/ws',
            relayGroupCapability: 'A'.repeat(43), groupSecret: 'B'.repeat(43),
        });

        await expect(service.claimInvite(bobRoot, lostInvite.invite.url)).rejects.toThrow();
        await service.claimInvite(bobRoot, replacementInvite.invite.url);
        await service.authorizeDevice(groupId, bobRoot, bobDevice.publicKey, 'Bob phone');
        await service.createExpense(groupId, aliceDevice, {
            description: 'Dinner', amountMinorUnits: 1000, currency: 'EUR',
            paidBy: aliceId, splits: { [aliceId]: 400, [bobId]: 600 },
        }, '018cc251-f400-7000-8000-000000000010');
        await service.createExpense(groupId, bobDevice, {
            description: 'Taxi', amountMinorUnits: 500, currency: 'EUR',
            paidBy: bobId, splits: { [aliceId]: 250, [bobId]: 250 },
        }, '018cc251-f400-7000-8000-000000000011');
        await service.correctExpense(
            groupId, aliceDevice, '018cc251-f400-7000-8000-000000000010',
            {
                description: 'Dinner with tip', amountMinorUnits: 1200, currency: 'EUR',
                paidBy: aliceId, splits: { [aliceId]: 500, [bobId]: 700 },
            },
            'Added tip',
        );
        await service.voidExpense(
            groupId, bobDevice, '018cc251-f400-7000-8000-000000000011', 'Duplicate',
        );

        const state = await service.getGroupState(groupId);
        expect(state?.participants[bobId]).toMatchObject({
            displayName: 'Bob', status: 'claimed', claimedRootPublicKey: bobRoot.publicKey,
        });
        expect(state?.capabilities[firstCapabilityId]?.status).toBe('revoked');
        expect(state?.capabilities[secondCapabilityId]?.status).toBe('consumed');
        expect(state?.expenses['018cc251-f400-7000-8000-000000000010']).toMatchObject({ status: 'effective' });
        expect(state?.expenses['018cc251-f400-7000-8000-000000000011']).toMatchObject({ status: 'void' });
        expect(state?.balances.EUR).toEqual({ [aliceId]: 700, [bobId]: -700 });
    });

    it('validates a remote operation union before persisting it', async () => {
        const source = new GroupServiceV2(new InMemoryOperationStorageV2());
        const targetStorage = new InMemoryOperationStorageV2();
        const target = new GroupServiceV2(targetStorage);
        const creator = generateKeyPair();
        await source.createGroup({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator,
            groupId, creatorParticipantId: aliceId,
        });
        await source.createParticipantSlot(groupId, creator, 'Bob', bobId);

        const sourceOperations = await source.getOperations(groupId);
        const state = await target.acceptOperations(groupId, [...sourceOperations].reverse());

        expect(state).toEqual(await source.getGroupState(groupId));
        expect(await target.getOperations(groupId)).toHaveLength(2);
        await expect(target.acceptOperations(
            '018cc251-f400-7000-8000-000000000099', sourceOperations,
        )).rejects.toThrow('another group');
        expect(await targetStorage.getGroupIds()).toEqual([groupId]);
    });

    it('lets a generic invite recipient choose one unclaimed participant slot', async () => {
        const service = new GroupServiceV2(new InMemoryOperationStorageV2());
        const creator = generateKeyPair();
        const recipient = generateKeyPair();
        const charlieId = '018cc251-f400-7000-8000-000000000006';
        await service.createGroup({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator,
            groupId, creatorParticipantId: aliceId,
        });
        await service.createParticipantSlot(groupId, creator, 'Bob', bobId);
        await service.createParticipantSlot(groupId, creator, 'Charlie', charlieId);
        const invite = await service.issueInviteForGroup(groupId, {
            actor: creator,
            scope: 'any-unclaimed-slot',
            capabilityId: firstCapabilityId,
            joinBaseUrl: 'https://join.example', relayUrl: 'wss://relay.example/ws',
            relayGroupCapability: 'A'.repeat(43), groupSecret: 'B'.repeat(43),
        });

        await expect(service.claimInvite(recipient, invite.invite.url)).rejects.toThrow('selected');
        await service.claimInvite(recipient, invite.invite.url, charlieId);

        const state = await service.getGroupState(groupId);
        expect(state?.participants[bobId]?.status).toBe('unclaimed');
        expect(state?.participants[charlieId]).toMatchObject({
            status: 'claimed', claimedRootPublicKey: recipient.publicKey,
        });
        expect(state?.capabilities[firstCapabilityId]).toMatchObject({
            scope: 'any-unclaimed-slot', status: 'consumed',
        });
    });

    it('deletes a group without retaining projected state', async () => {
        const service = new GroupServiceV2(new InMemoryOperationStorageV2());
        const creator = generateKeyPair();
        await service.createGroup({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator,
            groupId, creatorParticipantId: aliceId,
        });
        await service.deleteGroup(groupId);
        expect(await service.getGroupState(groupId)).toBeNull();
        expect(await service.getGroupIds()).toEqual([]);
    });
});
