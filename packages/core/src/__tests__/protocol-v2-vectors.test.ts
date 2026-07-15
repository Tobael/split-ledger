import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { canonicalize, hash, sign, verify } from '../crypto.js';
import {
    projectExpensesV2,
    projectParticipantClaimsV2,
    type ProjectionOperationV2,
} from '../protocol-v2/index.js';
import type { PublicKey, SecretKey, Signature } from '../types.js';

interface ProtocolV2Vector {
    secretKey: SecretKey;
    unsignedOperation: unknown;
    canonicalUtf8: string;
    operationId: string;
    signingMessage: string;
    signature: Signature;
}

interface ProjectionCase {
    name: string;
    projection: 'participantClaim' | 'expense';
    operations: ProjectionOperationV2[];
    expected: Record<string, unknown>;
}

interface ProjectionVectors {
    cases: ProjectionCase[];
}

const vectorUrl = new URL('../../../../docs/protocol/v2/test-vectors.json', import.meta.url);
const projectionVectorUrl = new URL(
    '../../../../docs/protocol/v2/projection-vectors.json',
    import.meta.url,
);

async function loadVector(): Promise<ProtocolV2Vector> {
    return JSON.parse(await readFile(vectorUrl, 'utf8')) as ProtocolV2Vector;
}

describe('protocol v2 compatibility vectors', () => {
    it('reproduces the canonical bytes, operation ID, and signature', async () => {
        const vector = await loadVector();
        const canonicalBytes = canonicalize(vector.unsignedOperation);
        const operationId = hash(canonicalBytes);
        const message = new TextEncoder().encode(`fair-money:v2:operation:${operationId}`);
        const signature = sign(message, vector.secretKey);
        const actorPublicKey = (
            vector.unsignedOperation as { actorPublicKey: PublicKey }
        ).actorPublicKey;

        expect(new TextDecoder().decode(canonicalBytes)).toBe(vector.canonicalUtf8);
        expect(operationId).toBe(vector.operationId);
        expect(new TextDecoder().decode(message)).toBe(vector.signingMessage);
        expect(signature).toBe(vector.signature);
        expect(verify(message, signature, actorPublicKey)).toBe(true);
    });

    it('reproduces every deterministic projection vector', async () => {
        const vectors = JSON.parse(
            await readFile(projectionVectorUrl, 'utf8'),
        ) as ProjectionVectors;

        for (const testCase of vectors.cases) {
            const actual = testCase.projection === 'participantClaim'
                ? [...projectParticipantClaimsV2(testCase.operations).values()][0]
                : [...projectExpensesV2(testCase.operations).values()][0];
            expect(actual, testCase.name).toEqual(testCase.expected);
        }
    });
});
