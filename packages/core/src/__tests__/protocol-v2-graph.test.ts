import { describe, expect, it } from 'vitest';

import {
    signOperationV2,
    validateOperationGraphV2,
    type SignedOperationV2,
    type UnsignedOperationV2,
} from '../protocol-v2/index.js';
import type { SecretKey } from '../types.js';

const secretKey = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60' as SecretKey;
const actorPublicKey = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';

function createRoot(groupId = '018cc251-f400-7000-8000-000000000001'): SignedOperationV2 {
    return signOperationV2({
        protocolVersion: 2,
        groupId,
        parents: [],
        lamportClock: 0,
        createdAt: 1767225600000,
        actorPublicKey,
        payload: { type: 'GroupCreated', groupName: 'Trip', creatorParticipantId: '018cc251-f400-7000-8000-000000000002', creatorDisplayName: 'Alice' },
    }, secretKey);
}

function createChild(root: SignedOperationV2, clock = 1, parentId = root.operationId): SignedOperationV2 {
    const operation: UnsignedOperationV2 = {
        protocolVersion: 2,
        groupId: root.groupId,
        parents: [parentId],
        lamportClock: clock,
        createdAt: 1767225600001,
        actorPublicKey,
        payload: { type: 'ParticipantSlotCreated', participantId: '018cc251-f400-7000-8000-000000000003', displayName: 'Bob' },
    };
    return signOperationV2(operation, secretKey);
}

describe('protocol v2 operation graph', () => {
    it('accepts input in any order and returns deterministic replay order', () => {
        const root = createRoot();
        const child = createChild(root);
        expect(validateOperationGraphV2([child, root]).map(({ operationId }) => operationId))
            .toEqual([root.operationId, child.operationId]);
    });

    it('rejects duplicate operations', () => {
        const root = createRoot();
        expect(() => validateOperationGraphV2([root, root])).toThrow('Duplicate');
    });

    it('rejects a missing parent', () => {
        const root = createRoot();
        const child = createChild(root, 1, 'f'.repeat(64));
        expect(() => validateOperationGraphV2([root, child])).toThrow('Missing');
    });

    it('rejects an incorrect Lamport clock even when correctly signed', () => {
        const root = createRoot();
        expect(() => validateOperationGraphV2([root, createChild(root, 2)])).toThrow('Lamport');
    });

    it('rejects multiple roots', () => {
        expect(() => validateOperationGraphV2([
            createRoot(),
            createRoot('018cc251-f400-7000-8000-000000000099'),
        ])).toThrow('exactly one');
    });
});
