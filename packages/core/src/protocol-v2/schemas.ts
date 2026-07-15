import { z } from 'zod';

const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveSafeInteger = safeInteger.min(1);
const lowercaseUuid = z.string().uuid().regex(/^[0-9a-f-]+$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const publicKey = hash;
const signature = z.string().regex(/^[0-9a-f]{128}$/);
const name = z.string().min(1).max(100);

export const expenseDataV2Schema = z.object({
    description: z.string().min(1).max(500),
    amountMinorUnits: positiveSafeInteger,
    currency: z.string().regex(/^[A-Z]{3}$/),
    paidBy: lowercaseUuid,
    splits: z.record(lowercaseUuid, safeInteger),
    category: z.string().max(100).optional(),
}).strict();

export const operationPayloadV2Schema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('GroupCreated'), groupName: name, creatorParticipantId: lowercaseUuid, creatorDisplayName: name, expenseEditPolicy: z.enum(['collaborative', 'creator-only', 'expense-author']).optional() }).strict(),
    z.object({ type: z.literal('ParticipantSlotCreated'), participantId: lowercaseUuid, displayName: name }).strict(),
    z.object({ type: z.literal('ParticipantSlotRenamed'), participantId: lowercaseUuid, displayName: name }).strict(),
    z.object({ type: z.literal('ParticipantSlotDisabled'), participantId: lowercaseUuid, reason: z.string().max(500).optional() }).strict(),
    z.object({ type: z.literal('ParticipantSlotReset'), participantId: lowercaseUuid, reason: z.string().max(500).optional() }).strict(),
    z.object({ type: z.literal('ClaimCapabilityIssued'), capabilityId: lowercaseUuid, scope: z.enum(['targeted', 'any-unclaimed-slot']), participantId: lowercaseUuid.optional(), secretCommitment: hash, displayExpiresAt: positiveSafeInteger.optional() }).strict(),
    z.object({ type: z.literal('ClaimCapabilityRevoked'), capabilityId: lowercaseUuid }).strict(),
    z.object({ type: z.literal('ParticipantSlotClaimed'), capabilityId: lowercaseUuid, participantId: lowercaseUuid, claimantRootPublicKey: publicKey, claimSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
    z.object({ type: z.literal('ExpenseCreated'), expenseId: lowercaseUuid, expense: expenseDataV2Schema }).strict(),
    z.object({ type: z.literal('ExpenseCorrected'), expenseId: lowercaseUuid, expense: expenseDataV2Schema, reason: z.string().min(1).max(500) }).strict(),
    z.object({ type: z.literal('ExpenseVoided'), expenseId: lowercaseUuid, reason: z.string().max(500).optional() }).strict(),
    z.object({ type: z.literal('SettlementCreated'), settlementId: lowercaseUuid, from: lowercaseUuid, to: lowercaseUuid, amountMinorUnits: positiveSafeInteger, currency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
    z.object({ type: z.literal('DeviceAuthorized'), ownerRootPublicKey: publicKey, devicePublicKey: publicKey, deviceName: name }).strict(),
    z.object({ type: z.literal('DeviceRevoked'), ownerRootPublicKey: publicKey, devicePublicKey: publicKey, reason: z.string().max(500).optional() }).strict(),
]);

export const unsignedOperationV2Schema = z.object({
    protocolVersion: z.literal(2),
    groupId: lowercaseUuid,
    parents: z.array(hash).max(32),
    lamportClock: safeInteger,
    createdAt: positiveSafeInteger,
    actorPublicKey: publicKey,
    payload: operationPayloadV2Schema,
}).strict().superRefine((operation, context) => {
    const sortedParents = [...operation.parents].sort();
    if (new Set(operation.parents).size !== operation.parents.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['parents'], message: 'Parent IDs must be unique' });
    }
    if (operation.parents.some((parent, index) => parent !== sortedParents[index])) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['parents'], message: 'Parent IDs must be lexicographically sorted' });
    }
    const isRoot = operation.payload.type === 'GroupCreated';
    if (isRoot !== (operation.parents.length === 0 && operation.lamportClock === 0)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Only GroupCreated may have an empty frontier and clock zero' });
    }
});

export const signedOperationV2Schema = z.object({
    protocolVersion: z.literal(2),
    operationId: hash,
    groupId: lowercaseUuid,
    parents: z.array(hash).max(32),
    lamportClock: safeInteger,
    createdAt: positiveSafeInteger,
    actorPublicKey: publicKey,
    payload: operationPayloadV2Schema,
    signature,
}).strict();

export type OperationPayloadV2 = z.infer<typeof operationPayloadV2Schema>;
export type ExpenseDataV2 = z.infer<typeof expenseDataV2Schema>;
export type UnsignedOperationV2 = z.infer<typeof unsignedOperationV2Schema>;
export type SignedOperationV2 = z.infer<typeof signedOperationV2Schema>;
