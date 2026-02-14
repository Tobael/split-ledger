// =============================================================================
// SplitLedger — Zod Schemas for Runtime Validation
// =============================================================================

import { z } from 'zod';
import { EntryType } from './types.js';

// --- Branded string schemas -------------------------------------------------

const publicKeySchema = z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid public key (expected 64 hex chars)');
const signatureSchema = z.string().regex(/^[0-9a-f]{128}$/i, 'Invalid signature (expected 128 hex chars)');
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid hash (expected 64 hex chars)');
const groupIdSchema = z.string().uuid('Invalid group ID (expected UUID v4)');

// --- Payload schemas --------------------------------------------------------

export const genesisPayloadSchema = z.object({
    groupId: groupIdSchema,
    groupName: z.string().min(1).max(200),
    creatorRootPubkey: publicKeySchema,
    creatorDisplayName: z.string().min(1).max(100),
});

export const expenseCreatedPayloadSchema = z.object({
    description: z.string().min(1).max(500),
    amountMinorUnits: z.number().int().positive(),
    currency: z.string().length(3),
    paidByRootPubkey: publicKeySchema,
    splits: z.record(publicKeySchema, z.number().int().nonnegative()),
    category: z.string().max(100).optional(),
    receiptHash: hashSchema.optional(),
});

export const expenseVoidedPayloadSchema = z.object({
    voidedEntryId: hashSchema,
    reason: z.string().optional(),
});

export const expenseCorrectionPayloadSchema = z.object({
    referencedEntryId: hashSchema,
    correctionReason: z.string().min(1).max(500),
    correctedExpense: expenseCreatedPayloadSchema,
});

export const inviteTokenSchema = z.object({
    groupId: groupIdSchema,
    inviterRootPubkey: publicKeySchema,
    expiresAt: z.number().int().positive(),
    inviteSignature: signatureSchema,
});

export const memberAddedPayloadSchema = z.object({
    memberRootPubkey: publicKeySchema,
    memberDisplayName: z.string().min(1).max(100),
    inviteToken: inviteTokenSchema,
});

export const memberRemovedPayloadSchema = z.object({
    memberRootPubkey: publicKeySchema,
    reason: z.string().min(1).max(500),
});

export const deviceAuthorizedPayloadSchema = z.object({
    ownerRootPubkey: publicKeySchema,
    devicePublicKey: publicKeySchema,
    deviceName: z.string().min(1).max(100),
    authorizationSignature: signatureSchema,
});

export const deviceRevokedPayloadSchema = z.object({
    ownerRootPubkey: publicKeySchema,
    devicePublicKey: publicKeySchema,
    reason: z.string().min(1).max(500),
});

const coSignatureSchema = z.object({
    signerRootPubkey: publicKeySchema,
    signature: signatureSchema,
});

export const rootKeyRotationPayloadSchema = z.object({
    previousRootPubkey: publicKeySchema,
    newRootPubkey: publicKeySchema,
    coSignatures: z.array(coSignatureSchema).min(1),
});

// --- Entry base schema ------------------------------------------------------

export const ledgerEntryBaseSchema = z.object({
    entryId: hashSchema,
    previousHash: hashSchema.nullable(),
    lamportClock: z.number().int().nonnegative(),
    timestamp: z.number().int().positive(),
    entryType: z.nativeEnum(EntryType),
    creatorDevicePubkey: publicKeySchema,
    signature: signatureSchema,
});

// --- Payload schema lookup --------------------------------------------------

export const payloadSchemas: Record<EntryType, z.ZodType> = {
    [EntryType.Genesis]: genesisPayloadSchema,
    [EntryType.ExpenseCreated]: expenseCreatedPayloadSchema,
    [EntryType.ExpenseVoided]: expenseVoidedPayloadSchema,
    [EntryType.ExpenseCorrection]: expenseCorrectionPayloadSchema,
    [EntryType.MemberAdded]: memberAddedPayloadSchema,
    [EntryType.MemberRemoved]: memberRemovedPayloadSchema,
    [EntryType.DeviceAuthorized]: deviceAuthorizedPayloadSchema,
    [EntryType.DeviceRevoked]: deviceRevokedPayloadSchema,
    [EntryType.RootKeyRotation]: rootKeyRotationPayloadSchema,
};

/**
 * Validate a ledger entry's structure (not crypto or chain integrity).
 * Returns parsed entry or throws ZodError.
 */
export function validateEntryStructure(entry: unknown): z.infer<typeof ledgerEntryBaseSchema> & { payload: unknown } {
    const base = ledgerEntryBaseSchema.extend({ payload: z.unknown() }).parse(entry);
    const payloadSchema = payloadSchemas[base.entryType as EntryType];
    if (payloadSchema) {
        base.payload = payloadSchema.parse(base.payload);
    }
    return base as z.infer<typeof ledgerEntryBaseSchema> & { payload: unknown };
}
