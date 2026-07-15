import { verifyOperationV2 } from './operation.js';
import type { SignedOperationV2 } from './schemas.js';

function compareOperations(a: SignedOperationV2, b: SignedOperationV2): number {
    return a.lamportClock - b.lamportClock || a.operationId.localeCompare(b.operationId);
}

/**
 * Verify a complete protocol-v2 operation set and return deterministic replay order.
 * Authorization and domain projection are intentionally separate stages.
 */
export function validateOperationGraphV2(values: readonly unknown[]): SignedOperationV2[] {
    const operations = values.map(verifyOperationV2);
    const byId = new Map<string, SignedOperationV2>();

    for (const operation of operations) {
        if (byId.has(operation.operationId)) {
            throw new Error(`Duplicate protocol v2 operation: ${operation.operationId}`);
        }
        byId.set(operation.operationId, operation);
    }

    const roots = operations.filter(({ payload }) => payload.type === 'GroupCreated');
    if (roots.length !== 1) {
        throw new Error('Protocol v2 operation set must contain exactly one GroupCreated root');
    }
    const groupId = roots[0]!.groupId;

    for (const operation of operations) {
        if (operation.groupId !== groupId) {
            throw new Error('Protocol v2 operation set contains multiple group IDs');
        }
        if (operation.payload.type === 'GroupCreated') continue;

        const parents = operation.parents.map((parentId) => {
            const parent = byId.get(parentId);
            if (!parent) throw new Error(`Missing protocol v2 parent: ${parentId}`);
            return parent;
        });
        const expectedClock = Math.max(...parents.map(({ lamportClock }) => lamportClock)) + 1;
        if (operation.lamportClock !== expectedClock) {
            throw new Error(`Invalid Lamport clock for protocol v2 operation: ${operation.operationId}`);
        }
    }

    return [...operations].sort(compareOperations);
}
