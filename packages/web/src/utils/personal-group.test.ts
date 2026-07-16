import { describe, expect, it } from 'vitest';
import {
    EntryType,
    type GroupId,
    type Hash,
    type LedgerEntry,
    type PublicKey,
    type Signature,
} from '@splitledger/core';
import { isPersonalSystemGroup, personalGroupIdFor } from './personal-group';

const root = 'abcdefghijklmnopqrstuvwxyz012345' as PublicKey;
const groupId = personalGroupIdFor(root);

function genesis(name = 'My Devices'): LedgerEntry {
    return {
        entryId: 'genesis' as Hash,
        previousHash: null,
        lamportClock: 0,
        timestamp: 1,
        entryType: EntryType.Genesis,
        creatorDevicePubkey: root,
        signature: 'signature' as Signature,
        payload: {
            groupId,
            groupName: name,
            creatorRootPubkey: root,
            creatorDisplayName: 'Me',
        },
    };
}

describe('personal system groups', () => {
    it('recognizes deterministic personal groups from previous local identities', () => {
        expect(isPersonalSystemGroup(groupId, [genesis()])).toBe(true);
    });

    it('does not hide an ordinary group merely because it has a similar name', () => {
        expect(isPersonalSystemGroup('ordinary-group' as GroupId, [genesis()])).toBe(false);
        expect(isPersonalSystemGroup(groupId, [genesis('Holiday')])).toBe(false);
    });
});
