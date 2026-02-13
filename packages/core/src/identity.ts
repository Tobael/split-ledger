// =============================================================================
// SplitLedger — Identity Manager
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import {
    canonicalize,
    generateKeyPair,
    sign,
    verify,
} from './crypto.js';
import type {
    DeviceIdentity,
    DeviceKeyAuthorization,
    Ed25519KeyPair,
    GroupId,
    InviteToken,
    PublicKey,
    RootIdentity,
    SecretKey,
    Signature,
} from './types.js';

// =============================================================================
// Root Identity
// =============================================================================

/**
 * Create a new root identity with a fresh Ed25519 keypair.
 */
export function createRootIdentity(displayName: string): RootIdentity {
    return {
        rootKeyPair: generateKeyPair(),
        displayName,
        createdAt: Date.now(),
    };
}

// =============================================================================
// Device Authorization
// =============================================================================

/**
 * Build the payload bytes that get signed for a device authorization.
 */
function deviceAuthPayload(
    devicePublicKey: PublicKey,
    rootPublicKey: PublicKey,
    authorizedAt: number,
): Uint8Array {
    return canonicalize({ devicePublicKey, rootPublicKey, authorizedAt });
}

/**
 * Create a device key authorization signed by the root key.
 */
export function createDeviceAuthorization(
    rootKeyPair: Ed25519KeyPair,
    devicePublicKey: PublicKey,
    deviceName: string,
    authorizedAt: number = Date.now(),
): DeviceKeyAuthorization {
    const payload = deviceAuthPayload(devicePublicKey, rootKeyPair.publicKey, authorizedAt);
    const authorizationSignature = sign(payload, rootKeyPair.secretKey);

    return {
        devicePublicKey,
        rootPublicKey: rootKeyPair.publicKey,
        deviceName,
        authorizedAt,
        authorizationSignature,
    };
}

/**
 * Verify a device key authorization against the root public key.
 */
export function verifyDeviceAuthorization(auth: DeviceKeyAuthorization): boolean {
    const payload = deviceAuthPayload(auth.devicePublicKey, auth.rootPublicKey, auth.authorizedAt);
    return verify(payload, auth.authorizationSignature, auth.rootPublicKey);
}

/**
 * Create a full device identity: generates device keypair and signs with root key.
 */
export function createDeviceIdentity(
    rootKeyPair: Ed25519KeyPair,
    deviceName: string,
): DeviceIdentity {
    const deviceKeyPair = generateKeyPair();
    const authorization = createDeviceAuthorization(
        rootKeyPair,
        deviceKeyPair.publicKey,
        deviceName,
    );

    return {
        deviceKeyPair,
        rootPublicKey: rootKeyPair.publicKey,
        deviceName,
        authorization,
    };
}

// =============================================================================
// Invite Token
// =============================================================================

/**
 * Build the payload bytes that get signed for an invite.
 */
function invitePayload(groupId: GroupId, inviterRootPubkey: PublicKey, expiresAt: number): Uint8Array {
    return canonicalize({ groupId, inviterRootPubkey, expiresAt });
}

/**
 * Create a signed invite token for a group.
 */
export function createInviteToken(
    groupId: GroupId,
    rootKeyPair: Ed25519KeyPair,
    ttlMs: number = 7 * 24 * 60 * 60 * 1000,
): InviteToken {
    const expiresAt = Date.now() + ttlMs;
    const payload = invitePayload(groupId, rootKeyPair.publicKey, expiresAt);
    const inviteSignature = sign(payload, rootKeyPair.secretKey);

    return {
        groupId,
        inviterRootPubkey: rootKeyPair.publicKey,
        expiresAt,
        inviteSignature,
    };
}

/**
 * Verify an invite token's cryptographic signature.
 * Does NOT check expiry or membership — caller must do that.
 */
export function verifyInviteSignature(token: InviteToken): boolean {
    const payload = invitePayload(token.groupId, token.inviterRootPubkey, token.expiresAt);
    return verify(payload, token.inviteSignature, token.inviterRootPubkey);
}

// =============================================================================
// Social Recovery Co-signature
// =============================================================================

/**
 * Build the payload bytes for a root key rotation co-signature.
 */
function recoveryPayload(
    previousRootPubkey: PublicKey,
    newRootPubkey: PublicKey,
    groupId: GroupId,
): Uint8Array {
    return canonicalize({ previousRootPubkey, newRootPubkey, groupId });
}

/**
 * Create a co-signature for a root key rotation (social recovery).
 */
export function createRecoveryCoSignature(
    previousRootPubkey: PublicKey,
    newRootPubkey: PublicKey,
    groupId: GroupId,
    signerSecretKey: SecretKey,
    signerRootPubkey: PublicKey,
): { signerRootPubkey: PublicKey; signature: Signature } {
    const payload = recoveryPayload(previousRootPubkey, newRootPubkey, groupId);
    const signature = sign(payload, signerSecretKey);
    return { signerRootPubkey, signature };
}

/**
 * Verify a single co-signature for a root key rotation.
 */
export function verifyRecoveryCoSignature(
    previousRootPubkey: PublicKey,
    newRootPubkey: PublicKey,
    groupId: GroupId,
    signerRootPubkey: PublicKey,
    signature: Signature,
): boolean {
    const payload = recoveryPayload(previousRootPubkey, newRootPubkey, groupId);
    return verify(payload, signature, signerRootPubkey);
}

// =============================================================================
// Group ID Generation
// =============================================================================

/**
 * Generate a new UUID v4 group ID.
 */
export function generateGroupId(): GroupId {
    return uuidv4() as GroupId;
}
