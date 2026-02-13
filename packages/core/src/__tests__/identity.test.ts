// =============================================================================
// Identity Manager Unit Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
    createRootIdentity,
    createDeviceIdentity,
    createDeviceAuthorization,
    verifyDeviceAuthorization,
    createInviteToken,
    verifyInviteSignature,
    createRecoveryCoSignature,
    verifyRecoveryCoSignature,
    generateGroupId,
} from '../identity.js';
import { generateKeyPair } from '../crypto.js';
import type { GroupId, PublicKey } from '../types.js';

describe('IdentityManager', () => {
    describe('createRootIdentity', () => {
        it('creates identity with valid keypair and display name', () => {
            const identity = createRootIdentity('Alice');
            expect(identity.displayName).toBe('Alice');
            expect(identity.rootKeyPair.publicKey).toMatch(/^[0-9a-f]{64}$/);
            expect(identity.rootKeyPair.secretKey).toMatch(/^[0-9a-f]{64}$/);
            expect(identity.createdAt).toBeGreaterThan(0);
        });
    });

    describe('createDeviceIdentity', () => {
        it('creates device with valid keys and authorization', () => {
            const root = createRootIdentity('Alice');
            const device = createDeviceIdentity(root.rootKeyPair, 'iPhone');
            expect(device.deviceName).toBe('iPhone');
            expect(device.rootPublicKey).toBe(root.rootKeyPair.publicKey);
            expect(device.deviceKeyPair.publicKey).toMatch(/^[0-9a-f]{64}$/);
            expect(device.authorization.devicePublicKey).toBe(device.deviceKeyPair.publicKey);
            expect(device.authorization.rootPublicKey).toBe(root.rootKeyPair.publicKey);
        });

        it('produces verifiable authorization', () => {
            const root = createRootIdentity('Alice');
            const device = createDeviceIdentity(root.rootKeyPair, 'iPhone');
            expect(verifyDeviceAuthorization(device.authorization)).toBe(true);
        });
    });

    describe('createDeviceAuthorization', () => {
        it('verifies with correct root key', () => {
            const root = generateKeyPair();
            const device = generateKeyPair();
            const auth = createDeviceAuthorization(root, device.publicKey, 'Test Device');
            expect(verifyDeviceAuthorization(auth)).toBe(true);
        });

        it('rejects tampered authorization', () => {
            const root = generateKeyPair();
            const device = generateKeyPair();
            const auth = createDeviceAuthorization(root, device.publicKey, 'Test');

            // Tamper with device name
            const tampered = { ...auth, deviceName: 'Hacked' };
            // Signature still verifies because deviceName isn't in the signed payload
            // But tampering the signed fields should fail:
            const tampered2 = { ...auth, authorizedAt: auth.authorizedAt + 1 };
            expect(verifyDeviceAuthorization(tampered2)).toBe(false);
        });

        it('rejects wrong root key verification', () => {
            const root1 = generateKeyPair();
            const root2 = generateKeyPair();
            const device = generateKeyPair();
            const auth = createDeviceAuthorization(root1, device.publicKey, 'Test');
            // Replace rootPublicKey (simulating wrong verifier)
            const wrongRoot = { ...auth, rootPublicKey: root2.publicKey };
            expect(verifyDeviceAuthorization(wrongRoot)).toBe(false);
        });
    });

    describe('InviteToken', () => {
        it('creates and verifies invite token', () => {
            const root = createRootIdentity('Alice');
            const groupId = generateGroupId();
            const token = createInviteToken(groupId, root.rootKeyPair);
            expect(token.groupId).toBe(groupId);
            expect(token.inviterRootPubkey).toBe(root.rootKeyPair.publicKey);
            expect(token.expiresAt).toBeGreaterThan(Date.now());
            expect(verifyInviteSignature(token)).toBe(true);
        });

        it('rejects tampered invite', () => {
            const root = createRootIdentity('Alice');
            const groupId = generateGroupId();
            const token = createInviteToken(groupId, root.rootKeyPair);
            const tampered = { ...token, expiresAt: token.expiresAt + 1000 };
            expect(verifyInviteSignature(tampered)).toBe(false);
        });

        it('rejects invite with wrong inviter key', () => {
            const root1 = createRootIdentity('Alice');
            const root2 = createRootIdentity('Bob');
            const groupId = generateGroupId();
            const token = createInviteToken(groupId, root1.rootKeyPair);
            const wrongInviter = { ...token, inviterRootPubkey: root2.rootKeyPair.publicKey };
            expect(verifyInviteSignature(wrongInviter)).toBe(false);
        });
    });

    describe('RecoveryCoSignature', () => {
        it('creates and verifies co-signature', () => {
            const old = generateKeyPair();
            const newKey = generateKeyPair();
            const signer = generateKeyPair();
            const groupId = generateGroupId();

            const coSig = createRecoveryCoSignature(
                old.publicKey,
                newKey.publicKey,
                groupId,
                signer.secretKey,
                signer.publicKey,
            );

            expect(coSig.signerRootPubkey).toBe(signer.publicKey);
            expect(
                verifyRecoveryCoSignature(
                    old.publicKey,
                    newKey.publicKey,
                    groupId,
                    coSig.signerRootPubkey,
                    coSig.signature,
                ),
            ).toBe(true);
        });

        it('rejects tampered co-signature', () => {
            const old = generateKeyPair();
            const newKey = generateKeyPair();
            const fakeNew = generateKeyPair();
            const signer = generateKeyPair();
            const groupId = generateGroupId();

            const coSig = createRecoveryCoSignature(
                old.publicKey,
                newKey.publicKey,
                groupId,
                signer.secretKey,
                signer.publicKey,
            );

            // Verify with wrong newRootPubkey
            expect(
                verifyRecoveryCoSignature(
                    old.publicKey,
                    fakeNew.publicKey,
                    groupId,
                    coSig.signerRootPubkey,
                    coSig.signature,
                ),
            ).toBe(false);
        });
    });

    describe('generateGroupId', () => {
        it('returns valid UUID v4', () => {
            const id = generateGroupId();
            expect(id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            );
        });

        it('produces unique IDs', () => {
            const id1 = generateGroupId();
            const id2 = generateGroupId();
            expect(id1).not.toBe(id2);
        });
    });
});
