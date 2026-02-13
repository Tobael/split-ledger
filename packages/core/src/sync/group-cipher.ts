// =============================================================================
// SplitLedger — Group Cipher (HKDF + AES-256-GCM)
// =============================================================================
//
// Encrypts/decrypts ledger entries for relay storage.
// Relay cannot read entry contents — only group members can.
//

import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import type { GroupId } from '../types.js';

const INFO = new TextEncoder().encode('splitledger-relay-encryption');
const KEY_LENGTH = 32; // AES-256
const NONCE_LENGTH = 12; // GCM standard

/**
 * Derive a group encryption key from a shared secret and group ID.
 *
 * groupEncryptionKey = HKDF-SHA256(
 *   ikm: sharedGroupSecret,
 *   salt: groupId,
 *   info: "splitledger-relay-encryption",
 *   length: 32
 * )
 */
export function deriveGroupKey(sharedSecret: Uint8Array, groupId: GroupId): Uint8Array {
    const salt = new TextEncoder().encode(groupId);
    return hkdf(sha256, sharedSecret, salt, INFO, KEY_LENGTH);
}

/**
 * Encrypt a serialized ledger entry for relay storage.
 * Format: [12-byte nonce][ciphertext + 16-byte auth tag]
 */
export function encryptForRelay(plaintext: Uint8Array, groupKey: Uint8Array): Uint8Array {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = gcm(groupKey, nonce);
    const ciphertext = cipher.encrypt(plaintext);

    // Prepend nonce
    const result = new Uint8Array(NONCE_LENGTH + ciphertext.length);
    result.set(nonce, 0);
    result.set(ciphertext, NONCE_LENGTH);
    return result;
}

/**
 * Decrypt a relay-stored encrypted entry.
 * Expects format: [12-byte nonce][ciphertext + 16-byte auth tag]
 * Throws if decryption fails (wrong key, tampered data).
 */
export function decryptFromRelay(encrypted: Uint8Array, groupKey: Uint8Array): Uint8Array {
    if (encrypted.length < NONCE_LENGTH + 16) {
        throw new Error('Encrypted data too short');
    }

    const nonce = encrypted.slice(0, NONCE_LENGTH);
    const ciphertext = encrypted.slice(NONCE_LENGTH);
    const cipher = gcm(groupKey, nonce);
    return cipher.decrypt(ciphertext);
}

/**
 * Serialize a ledger entry to bytes for encryption.
 */
export function serializeEntry(entry: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(entry));
}

/**
 * Deserialize bytes back to a ledger entry.
 */
export function deserializeEntry<T>(bytes: Uint8Array): T {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
