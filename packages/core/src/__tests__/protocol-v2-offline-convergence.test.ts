import { describe, expect, it } from 'vitest';

import { generateKeyPair } from '../crypto.js';
import {
    authorizeDeviceCommandV2,
    claimParticipantSlotCommandV2,
    createExpenseCommandV2,
    createGroupCommandV2,
    createParticipantSlotCommandV2,
    deriveGroupStateV2,
    issueClaimCapabilityCommandV2,
} from '../protocol-v2/index.js';

const groupId = '018cc251-f400-7000-8000-000000000001';
const aliceId = '018cc251-f400-7000-8000-000000000002';
const bobId = '018cc251-f400-7000-8000-000000000003';

describe('protocol v2 offline-client convergence', () => {
    it('projects identical state after concurrent offline writes arrive in opposite orders', () => {
        const aliceRoot = generateKeyPair();
        const aliceDevice = generateKeyPair();
        const bobRoot = generateKeyPair();
        const bobDevice = generateKeyPair();

        const root = createGroupCommandV2({
            groupName: 'Trip', creatorDisplayName: 'Alice', creator: aliceRoot,
            groupId, creatorParticipantId: aliceId, createdAt: 1767225600000,
        });
        const bobSlot = createParticipantSlotCommandV2(
            { history: [root], actor: aliceRoot, createdAt: 1767225600001 },
            'Bob', bobId,
        );
        const issued = issueClaimCapabilityCommandV2({
            history: [root, bobSlot], actor: aliceRoot, participantId: bobId,
            capabilityId: '018cc251-f400-7000-8000-000000000004', createdAt: 1767225600002,
        });
        const claim = claimParticipantSlotCommandV2(
            { history: [root, bobSlot, issued.operation], actor: bobRoot, createdAt: 1767225600003 },
            '018cc251-f400-7000-8000-000000000004', bobId, issued.claimSecret,
        );
        const aliceAuthorization = authorizeDeviceCommandV2(
            { history: [root, bobSlot, issued.operation, claim], actor: aliceRoot, createdAt: 1767225600004 },
            aliceDevice.publicKey, 'Alice phone',
        );
        const bobAuthorization = authorizeDeviceCommandV2(
            { history: [root, bobSlot, issued.operation, claim, aliceAuthorization], actor: bobRoot, createdAt: 1767225600005 },
            bobDevice.publicKey, 'Bob phone',
        );
        const sharedHistory = [root, bobSlot, issued.operation, claim, aliceAuthorization, bobAuthorization];

        // Both clients go offline with the same frontier and independently append one branch.
        const aliceExpense = createExpenseCommandV2(
            { history: sharedHistory, actor: aliceDevice, createdAt: 1767225600006 },
            {
                description: 'Dinner', amountMinorUnits: 1000, currency: 'EUR',
                paidBy: aliceId, splits: { [aliceId]: 400, [bobId]: 600 },
            },
            '018cc251-f400-7000-8000-000000000010',
        );
        const bobExpense = createExpenseCommandV2(
            { history: sharedHistory, actor: bobDevice, createdAt: 1767225600007 },
            {
                description: 'Taxi', amountMinorUnits: 500, currency: 'EUR',
                paidBy: bobId, splits: { [aliceId]: 250, [bobId]: 250 },
            },
            '018cc251-f400-7000-8000-000000000011',
        );

        expect(aliceExpense.parents).toEqual(bobExpense.parents);
        const aliceDeliveryOrder = [...sharedHistory, aliceExpense, bobExpense];
        const bobDeliveryOrder = [bobExpense, aliceExpense, ...[...sharedHistory].reverse()];
        const aliceState = deriveGroupStateV2(aliceDeliveryOrder);
        const bobState = deriveGroupStateV2(bobDeliveryOrder);

        expect(aliceState).toEqual(bobState);
        expect(aliceState.frontier).toEqual([aliceExpense.operationId, bobExpense.operationId].sort());
        expect(aliceState.balances.EUR).toEqual({ [aliceId]: 350, [bobId]: -350 });
    });
});
