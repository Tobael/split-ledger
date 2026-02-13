// =============================================================================
// SplitLedger — Cryptographic Service
// =============================================================================
//
// Pure functions wrapping @noble/ed25519 and @noble/hashes.
// No side effects, no I/O — suitable for all platforms.
//

import { etc, getPublicKey, sign as ed25519Sign, verify as ed25519Verify } from '@noble/ed25519';
import { sha512, sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import canonicalizeJson from 'canonicalize';

import type {
    Ed25519KeyPair,
    Hash,
    PublicKey,
    SecretKey,
    Signature,
    UnsignedEntryFields,
} from './types.js';

// @noble/ed25519 v2 requires setting the sha512 hash function
etc.sha512Sync = (...m: Uint8Array[]) => {
    const h = sha512.create();
    for (const msg of m) h.update(msg);
    return h.digest();
};

// =============================================================================
// Key Generation
// =============================================================================

/**
 * Generate a new Ed25519 keypair.
 * Uses crypto.getRandomValues (available in all target environments).
 */
export function generateKeyPair(): Ed25519KeyPair {
    const secretKeyBytes = etc.randomBytes(32);
    const publicKeyBytes = getPublicKey(secretKeyBytes);
    return {
        publicKey: bytesToHex(publicKeyBytes) as PublicKey,
        secretKey: bytesToHex(secretKeyBytes) as SecretKey,
    };
}

// =============================================================================
// Signing & Verification
// =============================================================================

/**
 * Sign a message with an Ed25519 secret key.
 */
export function sign(message: Uint8Array, secretKey: SecretKey): Signature {
    const sigBytes = ed25519Sign(message, hexToBytes(secretKey));
    return bytesToHex(sigBytes) as Signature;
}

/**
 * Verify an Ed25519 signature.
 */
export function verify(
    message: Uint8Array,
    signature: Signature,
    publicKey: PublicKey,
): boolean {
    try {
        return ed25519Verify(hexToBytes(signature), message, hexToBytes(publicKey));
    } catch {
        return false;
    }
}

// =============================================================================
// Hashing
// =============================================================================

/**
 * SHA-256 hash, returned as hex-encoded Hash.
 */
export function hash(data: Uint8Array): Hash {
    return bytesToHex(sha256(data)) as Hash;
}

// =============================================================================
// Canonical Serialization
// =============================================================================

/**
 * Deterministic JSON serialization (RFC 8785 — JCS).
 * Returns UTF-8 bytes suitable for hashing or signing.
 */
export function canonicalize(obj: unknown): Uint8Array {
    const json = canonicalizeJson(obj);
    if (json === undefined) {
        throw new Error('Cannot canonicalize undefined');
    }
    return new TextEncoder().encode(json);
}

// =============================================================================
// Entry ID Computation
// =============================================================================

/**
 * Compute the entry_id (SHA-256 hash) for a ledger entry.
 * Hashes the canonical serialization of all fields EXCEPT entryId and signature.
 */
export function computeEntryId(fields: UnsignedEntryFields): Hash {
    const content = {
        previousHash: fields.previousHash,
        lamportClock: fields.lamportClock,
        timestamp: fields.timestamp,
        entryType: fields.entryType,
        payload: fields.payload,
        creatorDevicePubkey: fields.creatorDevicePubkey,
    };
    return hash(canonicalize(content));
}

/**
 * Sign an entry_id with a device secret key, producing the entry signature.
 */
export function signEntryId(entryId: Hash, deviceSecretKey: SecretKey): Signature {
    return sign(new TextEncoder().encode(entryId), deviceSecretKey);
}

/**
 * Verify an entry's signature against its entry_id and creator device public key.
 */
export function verifyEntrySignature(
    entryId: Hash,
    signature: Signature,
    devicePublicKey: PublicKey,
): boolean {
    return verify(new TextEncoder().encode(entryId), signature, devicePublicKey);
}
