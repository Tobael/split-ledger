import { describe, expect, it } from 'vitest';

import { generateKeyPair } from '../crypto.js';
import {
    signOperationV2,
    validateAuthorizationV2,
    type OperationPayloadV2,
    type SignedOperationV2,
} from '../protocol-v2/index.js';
import type { Ed25519KeyPair } from '../types.js';

const groupId = '018cc251-f400-7000-8000-000000000001';
const creatorId = '018cc251-f400-7000-8000-000000000002';
const guestId = '018cc251-f400-7000-8000-000000000003';
const expenseId = '018cc251-f400-7000-8000-000000000010';

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

function expenseData(amountMinorUnits = 1000, splits = { [creatorId]: 1000 }) {
    return { description: 'Lunch', amountMinorUnits, currency: 'EUR', paidBy: creatorId, splits };
}

function authorizedCreatorHistory() {
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
    return { creator, device, root, authorization };
}

describe('protocol v2 expense authorization', () => {
    it('accepts a balanced expense from an authorized participant device', () => {
        const { device, root, authorization } = authorizedCreatorHistory();
        const expense = child(authorization, {
            type: 'ExpenseCreated', expenseId, expense: expenseData(),
        }, device);
        expect(validateAuthorizationV2([expense, root, authorization])).toHaveLength(3);
    });

    it('rejects routine expense creation signed directly by a root key', () => {
        const { creator, root } = authorizedCreatorHistory();
        const expense = child(root, {
            type: 'ExpenseCreated', expenseId, expense: expenseData(),
        }, creator);
        expect(() => validateAuthorizationV2([root, expense])).toThrow('device');
    });

    it('rejects an expense whose splits do not equal its amount', () => {
        const { device, root, authorization } = authorizedCreatorHistory();
        const expense = child(authorization, {
            type: 'ExpenseCreated', expenseId, expense: expenseData(1000, { [creatorId]: 999 }),
        }, device);
        expect(() => validateAuthorizationV2([root, authorization, expense])).toThrow('sum exactly');
    });

    it('accepts a correction under the explicit collaborative default policy', () => {
        const { device, root, authorization } = authorizedCreatorHistory();
        const expense = child(authorization, {
            type: 'ExpenseCreated', expenseId, expense: expenseData(),
        }, device);
        const correction = child(expense, {
            type: 'ExpenseCorrected', expenseId, expense: expenseData(1200, { [creatorId]: 1200 }),
            reason: 'Included tip',
        }, device);
        expect(validateAuthorizationV2([root, authorization, expense, correction])).toHaveLength(4);
    });

    it('rejects a correction causally after a void', () => {
        const { device, root, authorization } = authorizedCreatorHistory();
        const expense = child(authorization, {
            type: 'ExpenseCreated', expenseId, expense: expenseData(),
        }, device);
        const voidOperation = child(expense, { type: 'ExpenseVoided', expenseId }, device);
        const correction = child(voidOperation, {
            type: 'ExpenseCorrected', expenseId, expense: expenseData(), reason: 'Too late',
        }, device);
        expect(() => validateAuthorizationV2([root, authorization, expense, voidOperation, correction]))
            .toThrow('causally voided');
    });

    it('requires the paying participant device for settlements', () => {
        const { creator, device, root, authorization } = authorizedCreatorHistory();
        const guestSlot = child(authorization, {
            type: 'ParticipantSlotCreated', participantId: guestId, displayName: 'Bob',
        }, creator);
        const settlement = child(guestSlot, {
            type: 'SettlementCreated', settlementId: expenseId, from: guestId, to: creatorId,
            amountMinorUnits: 500, currency: 'EUR',
        }, device);
        expect(() => validateAuthorizationV2([root, authorization, guestSlot, settlement]))
            .toThrow('paying participant');
    });
});
