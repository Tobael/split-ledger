// =============================================================================
// CryptoService Unit Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
    generateKeyPair,
    sign,
    verify,
    hash,
    canonicalize,
    computeEntryId,
    signEntryId,
    verifyEntrySignature,
} from '../crypto.js';
import { EntryType } from '../types.js';
import type { PublicKey, SecretKey, Signature, Hash } from '../types.js';

describe('CryptoService', () => {
    describe('generateKeyPair', () => {
        it('produces keys with correct hex lengths', () => {
            const kp = generateKeyPair();
            expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/);
            expect(kp.secretKey).toMatch(/^[0-9a-f]{64}$/);
        });

        it('produces unique keypairs', () => {
            const kp1 = generateKeyPair();
            const kp2 = generateKeyPair();
            expect(kp1.publicKey).not.toBe(kp2.publicKey);
            expect(kp1.secretKey).not.toBe(kp2.secretKey);
        });
    });

    describe('sign + verify', () => {
        it('roundtrips successfully', () => {
            const kp = generateKeyPair();
            const message = new TextEncoder().encode('hello world');
            const sig = sign(message, kp.secretKey);
            expect(sig).toMatch(/^[0-9a-f]{128}$/);
            expect(verify(message, sig, kp.publicKey)).toBe(true);
        });

        it('rejects wrong public key', () => {
            const kp1 = generateKeyPair();
            const kp2 = generateKeyPair();
            const message = new TextEncoder().encode('test');
            const sig = sign(message, kp1.secretKey);
            expect(verify(message, sig, kp2.publicKey)).toBe(false);
        });

        it('rejects tampered message', () => {
            const kp = generateKeyPair();
            const message = new TextEncoder().encode('original');
            const sig = sign(message, kp.secretKey);
            const tampered = new TextEncoder().encode('tampered');
            expect(verify(tampered, sig, kp.publicKey)).toBe(false);
        });

        it('rejects invalid signature format gracefully', () => {
            const kp = generateKeyPair();
            const message = new TextEncoder().encode('test');
            expect(verify(message, 'invalid' as Signature, kp.publicKey)).toBe(false);
        });
    });

    describe('hash', () => {
        it('returns 64-char hex string', () => {
            const h = hash(new TextEncoder().encode('test'));
            expect(h).toMatch(/^[0-9a-f]{64}$/);
        });

        it('is deterministic', () => {
            const data = new TextEncoder().encode('deterministic');
            expect(hash(data)).toBe(hash(data));
        });

        it('differs for different input', () => {
            const h1 = hash(new TextEncoder().encode('input1'));
            const h2 = hash(new TextEncoder().encode('input2'));
            expect(h1).not.toBe(h2);
        });
    });

    describe('canonicalize', () => {
        it('is deterministic regardless of key order', () => {
            const obj1 = { b: 2, a: 1 };
            const obj2 = { a: 1, b: 2 };
            const c1 = canonicalize(obj1);
            const c2 = canonicalize(obj2);
            expect(new TextDecoder().decode(c1)).toBe(new TextDecoder().decode(c2));
        });

        it('produces UTF-8 bytes', () => {
            const bytes = canonicalize({ key: 'value' });
            expect(bytes).toBeInstanceOf(Uint8Array);
            expect(new TextDecoder().decode(bytes)).toBe('{"key":"value"}');
        });

        it('handles nested objects deterministically', () => {
            const obj = { z: { b: 2, a: 1 }, a: 'first' };
            const result = new TextDecoder().decode(canonicalize(obj));
            expect(result).toBe('{"a":"first","z":{"a":1,"b":2}}');
        });
    });

    describe('computeEntryId', () => {
        it('returns consistent hash for same input', () => {
            const fields = {
                previousHash: null,
                lamportClock: 0,
                timestamp: 1000,
                entryType: EntryType.Genesis,
                payload: { groupId: 'test', groupName: 'Test', creatorRootPubkey: 'abc', creatorDisplayName: 'Alice' },
                creatorDevicePubkey: 'def' as PublicKey,
            };
            const id1 = computeEntryId(fields);
            const id2 = computeEntryId(fields);
            expect(id1).toBe(id2);
            expect(id1).toMatch(/^[0-9a-f]{64}$/);
        });

        it('changes when any field changes', () => {
            const base = {
                previousHash: null,
                lamportClock: 0,
                timestamp: 1000,
                entryType: EntryType.Genesis,
                payload: { groupId: 'test', groupName: 'Test', creatorRootPubkey: 'abc', creatorDisplayName: 'Alice' },
                creatorDevicePubkey: 'def' as PublicKey,
            };
            const modified = { ...base, lamportClock: 1 };
            expect(computeEntryId(base)).not.toBe(computeEntryId(modified));
        });
    });

    describe('signEntryId + verifyEntrySignature', () => {
        it('roundtrips correctly', () => {
            const kp = generateKeyPair();
            const entryId = hash(new TextEncoder().encode('entry-content'));
            const sig = signEntryId(entryId, kp.secretKey);
            expect(verifyEntrySignature(entryId, sig, kp.publicKey)).toBe(true);
        });

        it('rejects wrong key', () => {
            const kp1 = generateKeyPair();
            const kp2 = generateKeyPair();
            const entryId = hash(new TextEncoder().encode('entry-content'));
            const sig = signEntryId(entryId, kp1.secretKey);
            expect(verifyEntrySignature(entryId, sig, kp2.publicKey)).toBe(false);
        });
    });
});
