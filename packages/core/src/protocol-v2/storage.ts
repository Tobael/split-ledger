import { signedOperationV2Schema, type SignedOperationV2 } from './schemas.js';
import { z } from 'zod';

const base64Secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const groupAccessV2Schema = z.object({
    groupId: z.string().uuid().regex(/^[0-9a-f-]+$/),
    relayUrl: z.string().url().refine((value) => {
        const url = new URL(value);
        return ['https:', 'wss:'].includes(url.protocol)
            || (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'ws:');
    }, {
        message: 'Relay URL must use HTTPS or WSS',
    }),
    relayGroupCapability: base64Secret,
    groupSecret: base64Secret,
}).strict();

export type GroupAccessV2 = z.infer<typeof groupAccessV2Schema>;

/** Durable protocol-v2 operation-set storage. Projection state is always derived, never authoritative. */
export interface OperationStorageV2 {
    putOperation(operation: SignedOperationV2): Promise<void>;
    getOperation(operationId: string): Promise<SignedOperationV2 | null>;
    getOperations(groupId: string): Promise<SignedOperationV2[]>;
    getGroupIds(): Promise<string[]>;
    deleteGroup(groupId: string): Promise<void>;
    close(): Promise<void>;
}

/** Platform storage for local group encryption material and relay access. */
export interface GroupAccessStorageV2 {
    storeGroupAccess(access: GroupAccessV2): Promise<void>;
    getGroupAccess(groupId: string): Promise<GroupAccessV2 | null>;
    deleteGroupAccess(groupId: string): Promise<void>;
    close(): Promise<void>;
}

function validated(operation: unknown): SignedOperationV2 {
    return signedOperationV2Schema.parse(operation);
}

/** Test and non-persistent host implementation of the v2 storage contract. */
export class InMemoryOperationStorageV2 implements OperationStorageV2 {
    private readonly operations = new Map<string, SignedOperationV2>();

    async putOperation(operation: SignedOperationV2): Promise<void> {
        const parsed = validated(operation);
        const existing = this.operations.get(parsed.operationId);
        if (existing && existing.groupId !== parsed.groupId) {
            throw new Error('Operation ID already belongs to another group');
        }
        this.operations.set(parsed.operationId, parsed);
    }

    async getOperation(operationId: string): Promise<SignedOperationV2 | null> {
        const operation = this.operations.get(operationId);
        return operation ? validated(operation) : null;
    }

    async getOperations(groupId: string): Promise<SignedOperationV2[]> {
        return [...this.operations.values()]
            .filter((operation) => operation.groupId === groupId)
            .map(validated);
    }

    async getGroupIds(): Promise<string[]> {
        return [...new Set([...this.operations.values()].map(({ groupId }) => groupId))].sort();
    }

    async deleteGroup(groupId: string): Promise<void> {
        for (const [operationId, operation] of this.operations) {
            if (operation.groupId === groupId) this.operations.delete(operationId);
        }
    }

    async close(): Promise<void> {}
}

export class InMemoryGroupAccessStorageV2 implements GroupAccessStorageV2 {
    private readonly groups = new Map<string, GroupAccessV2>();

    async storeGroupAccess(access: GroupAccessV2): Promise<void> {
        const parsed = groupAccessV2Schema.parse(access);
        this.groups.set(parsed.groupId, parsed);
    }

    async getGroupAccess(groupId: string): Promise<GroupAccessV2 | null> {
        const access = this.groups.get(groupId);
        return access ? groupAccessV2Schema.parse(access) : null;
    }

    async deleteGroupAccess(groupId: string): Promise<void> {
        this.groups.delete(groupId);
    }

    async close(): Promise<void> {}
}
