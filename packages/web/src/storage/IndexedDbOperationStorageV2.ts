import {
    signedOperationV2Schema,
    groupAccessV2Schema,
    type GroupAccessStorageV2,
    type GroupAccessV2,
    type OperationStorageV2,
    type SignedOperationV2,
} from '@splitledger/core';

const DATABASE_NAME = 'fair-money-v2';
const DATABASE_VERSION = 2;
const OPERATIONS = 'operations';
const GROUP_ACCESS = 'groupAccess';

interface StoredOperationV2 {
    operationId: string;
    groupId: string;
    operation: SignedOperationV2;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}

/** Clean v2-only browser operation store. It does not read or migrate the legacy ledger database. */
export class IndexedDbOperationStorageV2 implements OperationStorageV2, GroupAccessStorageV2 {
    private readonly database: Promise<IDBDatabase>;

    constructor(databaseName = DATABASE_NAME) {
        this.database = this.open(databaseName);
    }

    private open(databaseName: string): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, DATABASE_VERSION);
            request.onupgradeneeded = () => {
                const database = request.result;
                // Pre-release v2 storage has no migration contract. Reset obsolete
                // development schemas instead of retaining compatibility branches.
                for (const storeName of [...database.objectStoreNames]) {
                    database.deleteObjectStore(storeName);
                }
                const operations = database.createObjectStore(OPERATIONS, { keyPath: 'operationId' });
                operations.createIndex('groupId', 'groupId', { unique: false });
                database.createObjectStore(GROUP_ACCESS, { keyPath: 'groupId' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('Unable to open protocol-v2 IndexedDB'));
            request.onblocked = () => reject(new Error('Protocol-v2 IndexedDB is blocked by another Fair Money tab'));
        });
    }

    async putOperation(operation: SignedOperationV2): Promise<void> {
        const parsed = signedOperationV2Schema.parse(operation);
        const transaction = (await this.database).transaction(OPERATIONS, 'readwrite');
        const store = transaction.objectStore(OPERATIONS);
        const existing = await requestResult(
            store.get(parsed.operationId) as IDBRequest<StoredOperationV2 | undefined>,
        );
        if (existing && existing.groupId !== parsed.groupId) {
            transaction.abort();
            throw new Error('Operation ID already belongs to another group');
        }
        store.put({
            operationId: parsed.operationId,
            groupId: parsed.groupId,
            operation: parsed,
        } satisfies StoredOperationV2);
        await transactionDone(transaction);
    }

    async getOperation(operationId: string): Promise<SignedOperationV2 | null> {
        const transaction = (await this.database).transaction(OPERATIONS, 'readonly');
        const stored = await requestResult(
            transaction.objectStore(OPERATIONS).get(operationId) as IDBRequest<StoredOperationV2 | undefined>,
        );
        return stored ? signedOperationV2Schema.parse(stored.operation) : null;
    }

    async getOperations(groupId: string): Promise<SignedOperationV2[]> {
        const transaction = (await this.database).transaction(OPERATIONS, 'readonly');
        const records = await requestResult(
            transaction.objectStore(OPERATIONS).index('groupId').getAll(groupId) as IDBRequest<StoredOperationV2[]>,
        );
        return records
            .map(({ operation }) => signedOperationV2Schema.parse(operation))
            .sort((a, b) => a.lamportClock - b.lamportClock || a.operationId.localeCompare(b.operationId));
    }

    async getGroupIds(): Promise<string[]> {
        const transaction = (await this.database).transaction(OPERATIONS, 'readonly');
        const records = await requestResult(
            transaction.objectStore(OPERATIONS).getAll() as IDBRequest<StoredOperationV2[]>,
        );
        return [...new Set(records.map(({ groupId }) => groupId))].sort();
    }

    async deleteGroup(groupId: string): Promise<void> {
        const transaction = (await this.database).transaction([OPERATIONS, GROUP_ACCESS], 'readwrite');
        const store = transaction.objectStore(OPERATIONS);
        const keys = await requestResult(store.index('groupId').getAllKeys(groupId));
        for (const key of keys) store.delete(key);
        transaction.objectStore(GROUP_ACCESS).delete(groupId);
        await transactionDone(transaction);
    }

    async storeGroupAccess(access: GroupAccessV2): Promise<void> {
        const parsed = groupAccessV2Schema.parse(access);
        const transaction = (await this.database).transaction(GROUP_ACCESS, 'readwrite');
        transaction.objectStore(GROUP_ACCESS).put(parsed);
        await transactionDone(transaction);
    }

    async getGroupAccess(groupId: string): Promise<GroupAccessV2 | null> {
        const transaction = (await this.database).transaction(GROUP_ACCESS, 'readonly');
        const stored = await requestResult(
            transaction.objectStore(GROUP_ACCESS).get(groupId) as IDBRequest<GroupAccessV2 | undefined>,
        );
        return stored ? groupAccessV2Schema.parse(stored) : null;
    }

    async deleteGroupAccess(groupId: string): Promise<void> {
        const transaction = (await this.database).transaction(GROUP_ACCESS, 'readwrite');
        transaction.objectStore(GROUP_ACCESS).delete(groupId);
        await transactionDone(transaction);
    }

    async close(): Promise<void> {
        (await this.database).close();
    }
}
