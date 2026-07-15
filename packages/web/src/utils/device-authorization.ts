import { EntryType, orderEntries, type LedgerEntry } from '@splitledger/core';

export function isDeviceExplicitlyRevoked(entries: LedgerEntry[], devicePublicKey: string): boolean {
    const latestDeviceAuthorization = [...orderEntries([...entries])].reverse().find((entry) =>
        (entry.entryType === EntryType.DeviceAuthorized
            || entry.entryType === EntryType.DeviceRevoked)
        && entry.payload.devicePublicKey === devicePublicKey,
    );

    return latestDeviceAuthorization?.entryType === EntryType.DeviceRevoked;
}
