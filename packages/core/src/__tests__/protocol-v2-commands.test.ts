import { describe, expect, it } from 'vitest';

import { generateKeyPair, hash } from '../crypto.js';
import {
    appendCommandV2,
    authorizeDeviceCommandV2,
    claimParticipantSlotCommandV2,
    correctExpenseCommandV2,
    createExpenseCommandV2,
    createGroupCommandV2,
    createParticipantSlotCommandV2,
    deriveGroupStateV2,
    issueClaimCapabilityCommandV2,
    issueEncryptedInviteCommandV2,
    parseInviteV2,
    voidExpenseCommandV2,
} from '../protocol-v2/index.js';

const groupId = '018cc251-f400-7000-8000-000000000001';
const creatorId = '018cc251-f400-7000-8000-000000000002';
const firstGuestId = '018cc251-f400-7000-8000-000000000003';
const secondGuestId = '018cc251-f400-7000-8000-000000000004';

describe('protocol v2 command builders', () => {
    it('creates a signed group with its authorization policy in history', () => {
        const creator = generateKeyPair();
        const root = createGroupCommandV2({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator,
            groupId, creatorParticipantId: creatorId, expenseEditPolicy: 'creator-only',
            createdAt: 1767225600000,
        });
        expect(root.payload).toMatchObject({
            type: 'GroupCreated', expenseEditPolicy: 'creator-only',
        });
        expect(deriveGroupStateV2([root]).groupId).toBe(groupId);
    });

    it('merges every current frontier head into the next command', () => {
        const creator = generateKeyPair();
        const root = createGroupCommandV2({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator, groupId,
            creatorParticipantId: creatorId, createdAt: 1767225600000,
        });
        const first = appendCommandV2({
            history: [root], actor: creator, createdAt: 1767225600001,
            payload: { type: 'ParticipantSlotCreated', participantId: firstGuestId, displayName: 'Bob' },
        });
        const second = appendCommandV2({
            history: [root], actor: creator, createdAt: 1767225600001,
            payload: { type: 'ParticipantSlotCreated', participantId: secondGuestId, displayName: 'Carol' },
        });
        const merged = appendCommandV2({
            history: [second, root, first], actor: creator, createdAt: 1767225600002,
            payload: { type: 'ParticipantSlotRenamed', participantId: firstGuestId, displayName: 'Bobby' },
        });
        expect(merged.parents).toEqual([first.operationId, second.operationId].sort());
        expect(merged.lamportClock).toBe(2);
    });

    it('issues a secret-backed capability and completes its targeted claim', () => {
        const creator = generateKeyPair();
        const claimant = generateKeyPair();
        const root = createGroupCommandV2({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator, groupId,
            creatorParticipantId: creatorId, createdAt: 1767225600000,
        });
        const slot = createParticipantSlotCommandV2(
            { history: [root], actor: creator, createdAt: 1767225600001 },
            'Bob',
            firstGuestId,
        );
        const issued = issueClaimCapabilityCommandV2({
            history: [root, slot], actor: creator,
            capabilityId: '018cc251-f400-7000-8000-000000000005',
            participantId: firstGuestId, createdAt: 1767225600002,
        });
        const decoded = new Uint8Array(Buffer.from(
            issued.claimSecret.replace(/-/g, '+').replace(/_/g, '/'),
            'base64',
        ));
        expect(issued.claimSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(issued.operation.payload).toMatchObject({ secretCommitment: hash(decoded) });

        const claim = claimParticipantSlotCommandV2(
            { history: [root, slot, issued.operation], actor: claimant, createdAt: 1767225600003 },
            '018cc251-f400-7000-8000-000000000005',
            firstGuestId,
            issued.claimSecret,
        );
        expect(deriveGroupStateV2([root, slot, issued.operation, claim])
            .participants[firstGuestId]?.claimedRootPublicKey).toBe(claimant.publicKey);
    });

    it('does not return an unauthorized command', () => {
        const creator = generateKeyPair();
        const stranger = generateKeyPair();
        const root = createGroupCommandV2({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator, groupId,
            creatorParticipantId: creatorId,
        });
        expect(() => appendCommandV2({
            history: [root], actor: stranger,
            payload: { type: 'ParticipantSlotCreated', participantId: firstGuestId, displayName: 'Bob' },
        })).toThrow('Creator');
    });

    it('builds the device expense, correction, and void lifecycle', () => {
        const creator = generateKeyPair();
        const device = generateKeyPair();
        const root = createGroupCommandV2({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator, groupId,
            creatorParticipantId: creatorId, createdAt: 1767225600000,
        });
        const authorization = authorizeDeviceCommandV2(
            { history: [root], actor: creator, createdAt: 1767225600001 },
            device.publicKey,
            'Phone',
        );
        const expense = createExpenseCommandV2(
            { history: [root, authorization], actor: device, createdAt: 1767225600002 },
            { description: 'Lunch', amountMinorUnits: 1000, currency: 'EUR', paidBy: creatorId, splits: { [creatorId]: 1000 } },
            '018cc251-f400-7000-8000-000000000010',
        );
        const correction = correctExpenseCommandV2(
            { history: [root, authorization, expense], actor: device, createdAt: 1767225600003 },
            '018cc251-f400-7000-8000-000000000010',
            { description: 'Lunch with tip', amountMinorUnits: 1200, currency: 'EUR', paidBy: creatorId, splits: { [creatorId]: 1200 } },
            'Added tip',
        );
        const voidOperation = voidExpenseCommandV2(
            { history: [root, authorization, expense, correction], actor: device, createdAt: 1767225600004 },
            '018cc251-f400-7000-8000-000000000010',
            'Duplicate',
        );

        const state = deriveGroupStateV2([root, authorization, expense, correction, voidOperation]);
        expect(state.expenses['018cc251-f400-7000-8000-000000000010']?.status).toBe('void');
        expect(state.balances).toEqual({});
    });

    it('issues one encrypted invite bound to its signed capability operation', () => {
        const creator = generateKeyPair();
        const root = createGroupCommandV2({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator, groupId,
            creatorParticipantId: creatorId,
        });
        const slot = createParticipantSlotCommandV2(
            { history: [root], actor: creator }, 'Bob', firstGuestId,
        );
        const issued = issueEncryptedInviteCommandV2({
            history: [root, slot],
            actor: creator,
            participantId: firstGuestId,
            capabilityId: '018cc251-f400-7000-8000-000000000005',
            joinBaseUrl: 'https://join.example',
            relayUrl: 'wss://relay.example/sync',
            relayGroupCapability: 'A'.repeat(43),
            groupSecret: 'B'.repeat(43),
        });
        expect(parseInviteV2(issued.invite.url)).toMatchObject({
            groupId,
            participantId: firstGuestId,
            capabilityId: '018cc251-f400-7000-8000-000000000005',
            claimSecret: issued.claimSecret,
            issueOperationId: issued.operation.operationId,
        });
    });
});
