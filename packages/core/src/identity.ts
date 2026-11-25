import { generateKeyPair, sign, verify } from './crypto.js';
import { z } from 'zod';
import type { DeviceIdentity, Ed25519KeyPair, RootIdentity } from './types.js';

export function createRootIdentity(displayName: string): RootIdentity {
    return { rootKeyPair: generateKeyPair(), displayName, createdAt: Date.now() };
}

export function createDeviceIdentity(rootKeyPair: Ed25519KeyPair, deviceName: string): DeviceIdentity {
    const deviceKeyPair = generateKeyPair();
    return {
        deviceKeyPair,
        rootPublicKey: rootKeyPair.publicKey,
        deviceName,
    };
}

const key = z.string().regex(/^[0-9a-f]{64}$/);
export const identityKeyPairSchema = z.object({ publicKey: key, secretKey: key }).strict().superRefine((value, context) => {
    const pair = value as Ed25519KeyPair;
    const challenge = new TextEncoder().encode('fair-money-identity-key-validation');
    if (!verify(challenge, sign(challenge, pair.secretKey), pair.publicKey)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Identity key pair does not match' });
    }
});
export const rootIdentitySchema = z.object({
    rootKeyPair: identityKeyPairSchema,
    displayName: z.string().trim().min(1).max(100),
    createdAt: z.number().int().positive().safe(),
}).strict();
export const deviceIdentitySchema = z.object({
    deviceKeyPair: identityKeyPairSchema,
    rootPublicKey: key,
    deviceName: z.string().trim().min(1).max(100),
}).strict();
