import { z } from 'zod';
import { canonicalize, hash, sign, verify } from '../crypto.js';
import type { Ed25519KeyPair, PublicKey, Signature } from '../types.js';
import { groupAccessV2Schema } from './storage.js';

const key = z.string().regex(/^[0-9a-f]{64}$/);
const bodySchema = z.object({
    format: z.literal('fair-money-identity-directory'),
    version: z.literal(1),
    ownerRootPublicKey: key,
    directoryId: z.string().uuid(),
    payload: z.discriminatedUnion('type', [
        z.object({ type: z.literal('GroupShared'), access: groupAccessV2Schema, groupName: z.string().min(1).max(100) }).strict(),
        z.object({ type: z.literal('DeviceRegistered'), devicePublicKey: key, deviceName: z.string().min(1).max(100) }).strict(),
        z.object({ type: z.literal('DeviceRevoked'), devicePublicKey: key }).strict(),
    ]),
}).strict();
const recordSchema = bodySchema.extend({ recordId: key, signature: z.string().regex(/^[0-9a-f]{128}$/) }).strict();
export type IdentityDirectoryRecord = z.infer<typeof recordSchema>;
export type IdentityDirectoryPayload = IdentityDirectoryRecord['payload'];

export function signIdentityDirectoryRecord(root: Ed25519KeyPair, directoryId: string, payload: IdentityDirectoryPayload): IdentityDirectoryRecord {
    const body = bodySchema.parse({ format: 'fair-money-identity-directory', version: 1, ownerRootPublicKey: root.publicKey, directoryId, payload });
    const message = canonicalize(body);
    return { ...body, recordId: hash(message), signature: sign(message, root.secretKey) };
}

export function parseIdentityDirectoryRecord(value: unknown, owner: string, directoryId: string): IdentityDirectoryRecord {
    const record = recordSchema.parse(value);
    const { recordId, signature, ...body } = record;
    const message = canonicalize(body);
    if (body.ownerRootPublicKey !== owner || body.directoryId !== directoryId
        || hash(message) !== recordId || !verify(message, signature as Signature, owner as PublicKey)) {
        throw new Error('Invalid identity directory signature or namespace');
    }
    return record;
}

/** Add-only records; revocation always wins regardless of arrival order. */
export function projectIdentityDirectory(records: readonly IdentityDirectoryRecord[]) {
    const groups = new Map<string, { access: z.infer<typeof groupAccessV2Schema>; groupName: string }>();
    const devices = new Map<string, string>();
    const revokedDevices = new Set<string>();
    for (const { payload } of [...records].sort((a, b) => a.recordId.localeCompare(b.recordId))) {
        if (payload.type === 'GroupShared') {
            const existing = groups.get(payload.access.groupId);
            if (existing && canonicalize(existing.access).toString() !== canonicalize(payload.access).toString()) {
                throw new Error('Conflicting identity directory group access');
            }
            groups.set(payload.access.groupId, { access: payload.access, groupName: payload.groupName });
        } else if (payload.type === 'DeviceRegistered') devices.set(payload.devicePublicKey, payload.deviceName);
        else revokedDevices.add(payload.devicePublicKey);
    }
    return { groups, devices, revokedDevices };
}
