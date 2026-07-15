import { describe, expect, it } from 'vitest';

import {
    signOperationV2,
    unsignedOperationV2Schema,
    verifyOperationV2,
    type UnsignedOperationV2,
} from '../protocol-v2/index.js';
import type { SecretKey } from '../types.js';

const secretKey = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60' as SecretKey;

const rootOperation: UnsignedOperationV2 = {
    protocolVersion: 2,
    groupId: '018cc251-f400-7000-8000-000000000001',
    parents: [],
    lamportClock: 0,
    createdAt: 1767225600000,
    actorPublicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    payload: {
        type: 'GroupCreated',
        groupName: 'Ski Trip',
        creatorParticipantId: '018cc251-f400-7000-8000-000000000002',
        creatorDisplayName: 'Alice',
    },
};

describe('protocol v2 signed operations', () => {
    it('reproduces and verifies the normative root-operation vector', () => {
        const signed = signOperationV2(rootOperation, secretKey);

        expect(signed.operationId).toBe(
            '71a698dcccca876126656f70ab2549f555c1515436a1eb249d2c3ababe30298d',
        );
        expect(signed.signature).toBe(
            '08f67ca7af54f40783b2a035ceea291493088704bc8282162d87a07516828ea23673eb0fdf358147b3326f4c507be5993fd654fd86c8d82aac758dd5be1e890f',
        );
        expect(verifyOperationV2(signed)).toEqual(signed);
    });

    it('rejects content changed after signing', () => {
        const signed = signOperationV2(rootOperation, secretKey);
        expect(() => verifyOperationV2({
            ...signed,
            payload: { ...signed.payload, groupName: 'Changed' },
        })).toThrow('operation ID does not match');
    });

    it('rejects unknown signed fields', () => {
        const signed = signOperationV2(rootOperation, secretKey);
        expect(() => verifyOperationV2({ ...signed, futureField: true })).toThrow();
    });

    it('rejects duplicate or unsorted frontier parents', () => {
        const base = {
            ...rootOperation,
            parents: ['b'.repeat(64), 'a'.repeat(64)],
            lamportClock: 1,
            payload: {
                type: 'ParticipantSlotCreated' as const,
                participantId: '018cc251-f400-7000-8000-000000000003',
                displayName: 'Bob',
            },
        };

        expect(() => unsignedOperationV2Schema.parse(base)).toThrow();
        expect(() => unsignedOperationV2Schema.parse({
            ...base,
            parents: ['a'.repeat(64), 'a'.repeat(64)],
        })).toThrow();
    });

    it('rejects a non-root operation with an empty frontier', () => {
        expect(() => unsignedOperationV2Schema.parse({
            ...rootOperation,
            payload: {
                type: 'ParticipantSlotCreated',
                participantId: '018cc251-f400-7000-8000-000000000003',
                displayName: 'Bob',
            },
        })).toThrow();
    });
});
