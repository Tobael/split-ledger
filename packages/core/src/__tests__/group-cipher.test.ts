// =============================================================================
// Group Cipher Unit Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
    deriveGroupKey,
    encryptForRelay,
    decryptFromRelay,
    serializeEntry,
    deserializeEntry,
} from '../sync/group-cipher.js';
import type { GroupId } from '../types.js';

describe('GroupCipher', () => {
    const sharedSecret = new Uint8Array(32).fill(0xab);
    const groupId = '550e8400-e29b-41d4-a716-446655440000' as GroupId;

    describe('deriveGroupKey', () => {
        it('returns 32-byte key', () => {
            const key = deriveGroupKey(sharedSecret, groupId);
            expect(key).toBeInstanceOf(Uint8Array);
            expect(key.length).toBe(32);
        });

        it('is deterministic', () => {
            const key1 = deriveGroupKey(sharedSecret, groupId);
            const key2 = deriveGroupKey(sharedSecret, groupId);
            expect(key1).toEqual(key2);
        });

        it('differs for different group IDs', () => {
            const key1 = deriveGroupKey(sharedSecret, groupId);
            const key2 = deriveGroupKey(sharedSecret, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as GroupId);
            expect(key1).not.toEqual(key2);
        });

        it('differs for different secrets', () => {
            const secret2 = new Uint8Array(32).fill(0xcd);
            const key1 = deriveGroupKey(sharedSecret, groupId);
            const key2 = deriveGroupKey(secret2, groupId);
            expect(key1).not.toEqual(key2);
        });
    });

    describe('encryptForRelay + decryptFromRelay', () => {
        it('roundtrips binary data', () => {
            const key = deriveGroupKey(sharedSecret, groupId);
            const plaintext = new TextEncoder().encode('Hello, SplitLedger!');
            const encrypted = encryptForRelay(plaintext, key);
            const decrypted = decryptFromRelay(encrypted, key);
            expect(decrypted).toEqual(plaintext);
        });

        it('roundtrips large data', () => {
            const key = deriveGroupKey(sharedSecret, groupId);
            const plaintext = new Uint8Array(10000).fill(0x42);
            const encrypted = encryptForRelay(plaintext, key);
            const decrypted = decryptFromRelay(encrypted, key);
            expect(decrypted).toEqual(plaintext);
        });

        it('encrypted data is different from plaintext', () => {
            const key = deriveGroupKey(sharedSecret, groupId);
            const plaintext = new TextEncoder().encode('sensitive data');
            const encrypted = encryptForRelay(plaintext, key);
            // Encrypted should be nonce (12) + ciphertext + tag (16) = at least 28 + plaintext.length
            expect(encrypted.length).toBeGreaterThan(plaintext.length);
            // Should not contain plaintext verbatim
            const encStr = new TextDecoder().decode(encrypted);
            expect(encStr).not.toContain('sensitive data');
        });

        it('produces different ciphertext each time (random nonce)', () => {
            const key = deriveGroupKey(sharedSecret, groupId);
            const plaintext = new TextEncoder().encode('same message');
            const enc1 = encryptForRelay(plaintext, key);
            const enc2 = encryptForRelay(plaintext, key);
            // Nonces should differ
            expect(enc1.slice(0, 12)).not.toEqual(enc2.slice(0, 12));
        });

        it('rejects wrong key', () => {
            const key1 = deriveGroupKey(sharedSecret, groupId);
            const key2 = deriveGroupKey(new Uint8Array(32).fill(0xff), groupId);
            const plaintext = new TextEncoder().encode('secret');
            const encrypted = encryptForRelay(plaintext, key1);
            expect(() => decryptFromRelay(encrypted, key2)).toThrow();
        });

        it('rejects tampered ciphertext', () => {
            const key = deriveGroupKey(sharedSecret, groupId);
            const plaintext = new TextEncoder().encode('important');
            const encrypted = encryptForRelay(plaintext, key);
            // Tamper with a byte in the ciphertext
            encrypted[15] = encrypted[15]! ^ 0xff;
            expect(() => decryptFromRelay(encrypted, key)).toThrow();
        });

        it('rejects too-short data', () => {
            const key = deriveGroupKey(sharedSecret, groupId);
            expect(() => decryptFromRelay(new Uint8Array(10), key)).toThrow('too short');
        });
    });

    describe('serializeEntry + deserializeEntry', () => {
        it('roundtrips JSON objects', () => {
            const obj = { foo: 'bar', num: 42, nested: { a: [1, 2, 3] } };
            const bytes = serializeEntry(obj);
            const deserialized = deserializeEntry(bytes);
            expect(deserialized).toEqual(obj);
        });
    });

    describe('full encrypt/decrypt cycle with serialized entry', () => {
        it('roundtrips a mock ledger entry', () => {
            const key = deriveGroupKey(sharedSecret, groupId);
            const mockEntry = {
                entryId: 'abc123',
                entryType: 'ExpenseCreated',
                lamportClock: 5,
                timestamp: Date.now(),
                payload: { description: 'Lunch', amountMinorUnits: 1500, currency: 'EUR' },
            };

            const plaintext = serializeEntry(mockEntry);
            const encrypted = encryptForRelay(plaintext, key);
            const decrypted = decryptFromRelay(encrypted, key);
            const recovered = deserializeEntry(decrypted);
            expect(recovered).toEqual(mockEntry);
        });
    });
});
