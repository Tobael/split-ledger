import { EntryType, orderEntries, type GroupId, type LedgerEntry, type PublicKey } from '@splitledger/core';

export function personalGroupIdFor(rootPublicKey: PublicKey): GroupId {
    return `${rootPublicKey.slice(0, 8)}-${rootPublicKey.slice(8, 12)}-${rootPublicKey.slice(12, 16)}-${rootPublicKey.slice(16, 20)}-${rootPublicKey.slice(20, 32)}` as GroupId;
}

export function isPersonalSystemGroup(groupId: GroupId, entries: LedgerEntry[]): boolean {
    const genesis = orderEntries([...entries]).find((entry) => entry.entryType === EntryType.Genesis);
    return Boolean(
        genesis
        && genesis.timestamp === 1
        && genesis.payload.groupName === 'My Devices'
        && groupId === personalGroupIdFor(genesis.payload.creatorRootPubkey),
    );
}
