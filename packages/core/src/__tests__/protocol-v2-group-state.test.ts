import { describe, expect, it } from 'vitest';

import { generateKeyPair } from '../crypto.js';
import {
    deriveGroupStateV2,
    signOperationV2,
    type OperationPayloadV2,
    type SignedOperationV2,
} from '../protocol-v2/index.js';
import type { Ed25519KeyPair } from '../types.js';

const groupId = '018cc251-f400-7000-8000-000000000001';
const creatorId = '018cc251-f400-7000-8000-000000000002';
const guestId = '018cc251-f400-7000-8000-000000000003';

function child(parent: SignedOperationV2, payload: OperationPayloadV2, actor: Ed25519KeyPair) {
    return signOperationV2({
        protocolVersion: 2,
        groupId,
        parents: [parent.operationId],
        lamportClock: parent.lamportClock + 1,
        createdAt: parent.createdAt + 1,
        actorPublicKey: actor.publicKey,
        payload,
    }, actor.secretKey);
}

describe('protocol v2 complete group-state projection', () => {
    it('derives participants, devices, expenses, settlements, balances, and frontier', () => {
        const creator = generateKeyPair();
        const device = generateKeyPair();
        const root = signOperationV2({
            protocolVersion: 2,
            groupId,
            parents: [],
            lamportClock: 0,
            createdAt: 1767225600000,
            actorPublicKey: creator.publicKey,
            payload: { type: 'GroupCreated', groupName: 'Trip', creatorParticipantId: creatorId, creatorDisplayName: 'Alice' },
        }, creator.secretKey);
        const authorization = child(root, {
            type: 'DeviceAuthorized', ownerRootPublicKey: creator.publicKey,
            devicePublicKey: device.publicKey, deviceName: 'Phone',
        }, creator);
        const slot = child(authorization, {
            type: 'ParticipantSlotCreated', participantId: guestId, displayName: 'Bob',
        }, creator);
        const expense = child(slot, {
            type: 'ExpenseCreated', expenseId: '018cc251-f400-7000-8000-000000000010',
            expense: {
                description: 'Lunch', amountMinorUnits: 1000, currency: 'EUR', paidBy: creatorId,
                splits: { [creatorId]: 400, [guestId]: 600 },
            },
        }, device);
        const settlement = child(expense, {
            type: 'SettlementCreated', settlementId: '018cc251-f400-7000-8000-000000000011',
            from: creatorId, to: guestId, amountMinorUnits: 200, currency: 'EUR',
        }, device);

        const state = deriveGroupStateV2([settlement, expense, slot, root, authorization]);

        expect(state.groupName).toBe('Trip');
        expect(state.participants[creatorId]).toMatchObject({ displayName: 'Alice', status: 'claimed' });
        expect(state.participants[guestId]).toEqual({
            participantId: guestId, displayName: 'Bob', status: 'unclaimed',
        });
        expect(state.devices[device.publicKey]).toMatchObject({ deviceName: 'Phone', status: 'active' });
        expect(Object.keys(state.expenses)).toHaveLength(1);
        expect(Object.keys(state.settlements)).toHaveLength(1);
        expect(state.balances.EUR).toEqual({ [creatorId]: 800, [guestId]: -800 });
        expect(state.frontier).toEqual([settlement.operationId]);
        expect(state.operationCount).toBe(5);
    });

    it('keeps currencies in independent balance projections', () => {
        const creator = generateKeyPair();
        const device = generateKeyPair();
        const root = signOperationV2({
            protocolVersion: 2, groupId, parents: [], lamportClock: 0, createdAt: 1767225600000,
            actorPublicKey: creator.publicKey,
            payload: { type: 'GroupCreated', groupName: 'Trip', creatorParticipantId: creatorId, creatorDisplayName: 'Alice' },
        }, creator.secretKey);
        const authorization = child(root, {
            type: 'DeviceAuthorized', ownerRootPublicKey: creator.publicKey,
            devicePublicKey: device.publicKey, deviceName: 'Phone',
        }, creator);
        const expense = child(authorization, {
            type: 'ExpenseCreated', expenseId: '018cc251-f400-7000-8000-000000000012',
            expense: { description: 'Coffee', amountMinorUnits: 500, currency: 'USD', paidBy: creatorId, splits: { [creatorId]: 500 } },
        }, device);

        expect(deriveGroupStateV2([root, authorization, expense]).balances).toEqual({
            USD: { [creatorId]: 0 },
        });
    });
});
