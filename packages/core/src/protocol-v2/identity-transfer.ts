import { z } from 'zod';
import { rootIdentitySchema } from '../identity.js';
import type { Ed25519KeyPair } from '../types.js';
import { deriveGroupStateV2 } from './projector.js';
import { signedOperationV2Schema } from './schemas.js';
import { groupAccessV2Schema } from './storage.js';
import { parseIdentityDirectoryRecord, projectIdentityDirectory } from './identity-directory.js';

export const storedRootIdentitySchema = rootIdentitySchema.extend({ directoryAccess: groupAccessV2Schema }).strict();
const transferSchema = z.object({
    format: z.literal('fair-money-identity-transfer'),
    version: z.literal(3),
    identity: storedRootIdentitySchema.omit({ createdAt: true }),
    directoryRecords: z.array(z.unknown()),
    groups: z.array(z.object({
        access: groupAccessV2Schema,
        operations: z.array(signedOperationV2Schema).min(1),
    }).strict()),
}).strict();

export type IdentityTransfer = z.infer<typeof transferSchema>;

/** Validate the entire snapshot before replacing any local data. */
export function parseIdentityTransfer(value: unknown): IdentityTransfer {
    const transfer = transferSchema.parse(value);
    const root = transfer.identity.rootKeyPair as Ed25519KeyPair;
    transfer.directoryRecords = transfer.directoryRecords.map((record) => parseIdentityDirectoryRecord(
        record, root.publicKey, transfer.identity.directoryAccess.groupId,
    ));
    const directory = projectIdentityDirectory(transfer.directoryRecords as ReturnType<typeof parseIdentityDirectoryRecord>[]);
    const ids = new Set<string>();
    for (const { access, operations } of transfer.groups) {
        if (access.groupId === transfer.identity.directoryAccess.groupId) throw new Error('Directory cannot be a product group');
        if (ids.has(access.groupId)) throw new Error('Duplicate transferred group');
        ids.add(access.groupId);
        if (operations.some(({ groupId }) => groupId !== access.groupId)) {
            throw new Error('Transferred history belongs to another group');
        }
        const shared = directory.groups.get(access.groupId)?.access;
        if (shared && (shared.groupSecret !== access.groupSecret || shared.relayGroupCapability !== access.relayGroupCapability || shared.relayUrl !== access.relayUrl)) {
            throw new Error('Transferred group access conflicts with identity directory');
        }
        const state = deriveGroupStateV2(operations);
        if (!Object.values(state.participants).some(({ claimedRootPublicKey, status }) =>
            status === 'claimed' && claimedRootPublicKey === root.publicKey)) {
            throw new Error('Transferred identity does not own a participant in this group');
        }
    }
    return transfer;
}
