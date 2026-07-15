import { describe, expect, it } from 'vitest';
import {
    EntryType,
    type Hash,
    type LedgerEntry,
    type PublicKey,
    type Signature,
} from '@splitledger/core';
import { isDeviceExplicitlyRevoked } from './device-authorization';

const rootPublicKey = 'root' as PublicKey;
const devicePublicKey = 'device' as PublicKey;
const signature = 'signature' as Signature;

function deviceEntry(entryType: EntryType.DeviceAuthorized | EntryType.DeviceRevoked, timestamp: number): LedgerEntry {
    const base = {
        entryId: `${timestamp}`.padStart(64, '0') as Hash,
        previousHash: null,
        timestamp,
        lamportClock: timestamp,
        creatorDevicePubkey: rootPublicKey,
        signature,
    };
    if (entryType === EntryType.DeviceAuthorized) {
        return {
            ...base,
            entryType,
            payload: {
                ownerRootPubkey: rootPublicKey,
                devicePublicKey,
                deviceName: 'Browser',
                authorizationSignature: signature,
            },
        };
    }
    return {
        ...base,
        entryType,
        payload: { ownerRootPubkey: rootPublicKey, devicePublicKey, reason: 'Lost' },
    };
}

describe('isDeviceExplicitlyRevoked', () => {
    it('does not treat missing authorization as revocation', () => {
        expect(isDeviceExplicitlyRevoked([], 'device')).toBe(false);
    });

    it('recognizes an explicit revocation', () => {
        expect(isDeviceExplicitlyRevoked([
            deviceEntry(EntryType.DeviceAuthorized, 1),
            deviceEntry(EntryType.DeviceRevoked, 2),
        ], 'device')).toBe(true);
    });

    it('recognizes authorization after an earlier revocation', () => {
        expect(isDeviceExplicitlyRevoked([
            deviceEntry(EntryType.DeviceAuthorized, 1),
            deviceEntry(EntryType.DeviceRevoked, 2),
            deviceEntry(EntryType.DeviceAuthorized, 3),
        ], 'device')).toBe(false);
    });
});
