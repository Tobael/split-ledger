import { gcm } from '@noble/ciphers/aes';
import { z } from 'zod';

import { canonicalize, generateRandomBytes } from '../crypto.js';

const INVITE_AAD = new TextEncoder().encode('fair-money:v2:invite');
const NONCE_LENGTH = 12;
const base64Secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

function secureOrLoopback(url: URL, secureProtocols: readonly string[]): boolean {
    return secureProtocols.includes(url.protocol)
        || (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            && ['http:', 'ws:'].includes(url.protocol));
}

export const invitePayloadV2Schema = z.object({
    protocolVersion: z.literal(2),
    groupId: z.string().uuid().regex(/^[0-9a-f-]+$/),
    relayUrl: z.string().url().refine((value) => secureOrLoopback(new URL(value), ['https:', 'wss:']), {
        message: 'Relay URL must use HTTPS or WSS',
    }),
    relayGroupCapability: base64Secret,
    groupSecret: base64Secret,
    scope: z.enum(['targeted', 'any-unclaimed-slot']),
    participantId: z.string().uuid().regex(/^[0-9a-f-]+$/).optional(),
    capabilityId: z.string().uuid().regex(/^[0-9a-f-]+$/),
    claimSecret: base64Secret,
    issueOperationId: z.string().regex(/^[0-9a-f]{64}$/),
    displayExpiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().superRefine((invite, context) => {
    if ((invite.scope === 'targeted') !== Boolean(invite.participantId)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['participantId'],
            message: 'Targeted invites require exactly one participant ID',
        });
    }
});

export type InvitePayloadV2 = z.infer<typeof invitePayloadV2Schema>;

export interface EncryptedInviteV2 {
    url: string;
    token: string;
    decryptionKey: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
    let base64: string;
    if (typeof Buffer !== 'undefined') base64 = Buffer.from(bytes).toString('base64');
    else base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid protocol v2 invite encoding');
    let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function inviteParts(input: string): { token: string; key: string } {
    try {
        const url = new URL(input);
        const match = url.pathname.match(/^\/invite\/([^/]+)\/?$/);
        const key = new URLSearchParams(url.hash.slice(1)).get('key');
        if (!match?.[1] || !key) throw new Error('Missing invite ciphertext or fragment key');
        return { token: decodeURIComponent(match[1]), key };
    } catch (error) {
        if (input.includes('://')) throw error;
        const [token, fragment = ''] = input.split('#', 2);
        const key = new URLSearchParams(fragment).get('key');
        if (!token || !key) throw new Error('Missing invite ciphertext or fragment key');
        return { token, key };
    }
}

/**
 * Encrypt an invite. The HTTPS path contains only ciphertext; its AES key is in
 * the fragment, which browsers do not send to the static join server.
 */
export function createInviteV2(
    payload: InvitePayloadV2,
    joinBaseUrl: string,
): EncryptedInviteV2 {
    const parsed = invitePayloadV2Schema.parse(payload);
    const base = new URL(joinBaseUrl);
    if (!secureOrLoopback(base, ['https:'])) throw new Error('Join URL must use HTTPS');
    const key = generateRandomBytes(32);
    const nonce = generateRandomBytes(NONCE_LENGTH);
    const ciphertext = gcm(key, nonce, INVITE_AAD).encrypt(canonicalize(parsed));
    const encrypted = new Uint8Array(nonce.length + ciphertext.length);
    encrypted.set(nonce);
    encrypted.set(ciphertext, nonce.length);
    const token = base64UrlEncode(encrypted);
    const decryptionKey = base64UrlEncode(key);
    const url = new URL(`/invite/${encodeURIComponent(token)}`, base);
    url.hash = new URLSearchParams({ key: decryptionKey }).toString();
    return { url: url.toString(), token, decryptionKey };
}

/** Decrypt and strictly validate a full HTTPS invite URL or compact token reference. */
export function parseInviteV2(input: string): InvitePayloadV2 {
    try {
        const { token, key } = inviteParts(input);
        const encrypted = base64UrlDecode(token);
        const keyBytes = base64UrlDecode(key);
        if (keyBytes.length !== 32 || encrypted.length < NONCE_LENGTH + 16) {
            throw new Error('Invalid encrypted invite length');
        }
        const plaintext = gcm(
            keyBytes,
            encrypted.slice(0, NONCE_LENGTH),
            INVITE_AAD,
        ).decrypt(encrypted.slice(NONCE_LENGTH));
        return invitePayloadV2Schema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
    } catch {
        throw new Error('Invalid or tampered protocol v2 invite');
    }
}
