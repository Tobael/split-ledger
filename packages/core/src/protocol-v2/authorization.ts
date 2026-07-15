import { validateMembershipAuthorizationV2 } from './membership-authorization.js';
import type { SignedOperationV2 } from './schemas.js';

export type ExpenseEditPolicyV2 = 'collaborative' | 'creator-only' | 'expense-author';

export const defaultExpenseEditPolicyV2: ExpenseEditPolicyV2 = 'collaborative';

interface ParticipantAuthorizationState {
    participantId: string;
    disabled: boolean;
    rootPublicKey?: string;
}

function compareOperations(a: SignedOperationV2, b: SignedOperationV2): number {
    return a.lamportClock - b.lamportClock || a.operationId.localeCompare(b.operationId);
}

function ancestorsFor(
    operation: SignedOperationV2,
    byId: ReadonlyMap<string, SignedOperationV2>,
): SignedOperationV2[] {
    const found = new Map<string, SignedOperationV2>();
    const pending = [...operation.parents];
    while (pending.length > 0) {
        const id = pending.pop()!;
        if (found.has(id)) continue;
        const parent = byId.get(id)!;
        found.set(id, parent);
        pending.push(...parent.parents);
    }
    return [...found.values()].sort(compareOperations);
}

function participantState(causal: readonly SignedOperationV2[]): Map<string, ParticipantAuthorizationState> {
    const participants = new Map<string, ParticipantAuthorizationState>();
    for (const operation of causal) {
        const payload = operation.payload;
        if (payload.type === 'GroupCreated') {
            participants.set(payload.creatorParticipantId, {
                participantId: payload.creatorParticipantId,
                disabled: false,
                rootPublicKey: operation.actorPublicKey,
            });
        } else if (payload.type === 'ParticipantSlotCreated') {
            participants.set(payload.participantId, { participantId: payload.participantId, disabled: false });
        } else if (payload.type === 'ParticipantSlotDisabled') {
            const participant = participants.get(payload.participantId);
            if (participant) participant.disabled = true;
        } else if (payload.type === 'ParticipantSlotReset') {
            const participant = participants.get(payload.participantId);
            if (participant) delete participant.rootPublicKey;
        } else if (payload.type === 'ParticipantSlotClaimed') {
            const participant = participants.get(payload.participantId);
            if (participant && !participant.rootPublicKey) participant.rootPublicKey = payload.claimantRootPublicKey;
        }
    }
    return participants;
}

function activeDeviceOwner(actor: string, causal: readonly SignedOperationV2[]): string | undefined {
    const authorizations = causal.filter(({ payload }) =>
        payload.type === 'DeviceAuthorized' && payload.devicePublicKey === actor);
    const authorization = authorizations.at(-1);
    if (!authorization || authorization.payload.type !== 'DeviceAuthorized') return undefined;
    const ownerRootPublicKey = authorization.payload.ownerRootPublicKey;
    const revoked = causal.some(({ payload }) =>
        payload.type === 'DeviceRevoked'
        && payload.ownerRootPublicKey === ownerRootPublicKey
        && payload.devicePublicKey === actor);
    return revoked ? undefined : ownerRootPublicKey;
}

function activeActorParticipant(
    operation: SignedOperationV2,
    causal: readonly SignedOperationV2[],
    participants: ReadonlyMap<string, ParticipantAuthorizationState>,
): ParticipantAuthorizationState {
    const owner = activeDeviceOwner(operation.actorPublicKey, causal);
    const participant = [...participants.values()].find((candidate) =>
        !candidate.disabled && candidate.rootPublicKey === owner);
    if (!participant) throw new Error(`${operation.payload.type} requires an authorized active participant device`);
    return participant;
}

function assertExpenseDataParticipants(
    expense: { amountMinorUnits: number; paidBy: string; splits: Record<string, number> },
    participants: ReadonlyMap<string, ParticipantAuthorizationState>,
): void {
    const referenced = new Set([expense.paidBy, ...Object.keys(expense.splits)]);
    for (const participantId of referenced) {
        const participant = participants.get(participantId);
        if (!participant || participant.disabled) throw new Error('Expense references an inactive participant slot');
    }
    const splitTotal = Object.values(expense.splits).reduce((sum, share) => sum + share, 0);
    if (splitTotal !== expense.amountMinorUnits) throw new Error('Expense splits must sum exactly to its amount');
}

function expenseCreatorParticipant(
    expenseId: string,
    causal: readonly SignedOperationV2[],
    participants: ReadonlyMap<string, ParticipantAuthorizationState>,
): ParticipantAuthorizationState | undefined {
    const created = causal.find(({ payload }) =>
        payload.type === 'ExpenseCreated' && payload.expenseId === expenseId);
    if (!created) return undefined;
    const createdCausal = causal.filter((candidate) =>
        candidate.lamportClock < created.lamportClock
        || (candidate.lamportClock === created.lamportClock
            && candidate.operationId.localeCompare(created.operationId) < 0));
    const owner = activeDeviceOwner(created.actorPublicKey, createdCausal);
    return [...participants.values()].find(({ rootPublicKey }) => rootPublicKey === owner);
}

function assertExpenseAuthorized(
    operation: SignedOperationV2,
    causal: readonly SignedOperationV2[],
    creatorParticipantId: string,
    expenseEditPolicy: ExpenseEditPolicyV2,
): void {
    const payload = operation.payload;
    if (!['ExpenseCreated', 'ExpenseCorrected', 'ExpenseVoided', 'SettlementCreated'].includes(payload.type)) return;
    const participants = participantState(causal);
    const actor = activeActorParticipant(operation, causal, participants);

    if (payload.type === 'SettlementCreated') {
        if (actor.participantId !== payload.from) throw new Error('Settlement must be signed by the paying participant device');
        const recipient = participants.get(payload.to);
        if (!recipient || recipient.disabled) throw new Error('Settlement recipient must be active');
        if (payload.from === payload.to) throw new Error('Settlement participants must differ');
        return;
    }

    if (payload.type === 'ExpenseCreated') {
        const createdExpenseId = payload.expenseId;
        assertExpenseDataParticipants(payload.expense, participants);
        if (causal.some((entry) => entry.payload.type === 'ExpenseCreated'
            && entry.payload.expenseId === createdExpenseId)) {
            throw new Error('Expense ID already exists in causal state');
        }
        return;
    }

    if (payload.type !== 'ExpenseCorrected' && payload.type !== 'ExpenseVoided') return;
    const referencedExpenseId = payload.expenseId;

    const created = causal.find((entry) => entry.payload.type === 'ExpenseCreated'
        && entry.payload.expenseId === referencedExpenseId);
    if (!created) throw new Error('Expense correction or void requires an existing expense');
    const voided = causal.some((entry) => entry.payload.type === 'ExpenseVoided'
        && entry.payload.expenseId === referencedExpenseId);
    if (voided) throw new Error('A causally voided expense cannot be changed');

    if (expenseEditPolicy === 'creator-only' && actor.participantId !== creatorParticipantId) {
        throw new Error('Expense edit requires the group creator');
    }
    if (expenseEditPolicy === 'expense-author') {
        const author = expenseCreatorParticipant(referencedExpenseId, causal, participants);
        if (author?.participantId !== actor.participantId) throw new Error('Expense edit requires its author');
    }
    if (payload.type === 'ExpenseCorrected') assertExpenseDataParticipants(payload.expense, participants);
}

/** Validate the complete currently specified v2 authorization policy. */
export function validateAuthorizationV2(
    values: readonly unknown[],
): SignedOperationV2[] {
    const ordered = validateMembershipAuthorizationV2(values);
    const root = ordered[0]!;
    if (root.payload.type !== 'GroupCreated') throw new Error('Invalid protocol v2 root');
    const expenseEditPolicy = root.payload.expenseEditPolicy ?? defaultExpenseEditPolicyV2;
    const byId = new Map(ordered.map((operation) => [operation.operationId, operation]));
    for (const operation of ordered) {
        assertExpenseAuthorized(
            operation,
            ancestorsFor(operation, byId),
            root.payload.creatorParticipantId,
            expenseEditPolicy,
        );
    }
    return ordered;
}
