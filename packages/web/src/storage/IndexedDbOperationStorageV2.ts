import {
    signedOperationV2Schema,
    storedRootIdentitySchema,
    deviceIdentitySchema,
    parseIdentityDirectoryRecord,
    type IdentityDirectoryRecord,
    deriveGroupStateV2,
    groupAccessV2Schema,
    type GroupAccessStorageV2,
    type GroupAccessV2,
    type OperationStorageV2,
    type SignedOperationV2,
} from '@splitledger/core';
import type { IdentityStore, StoredIdentity, StoredRootIdentity } from './IdentityStore';

const DATABASE_NAME = 'fair-money-v2';
const DATABASE_VERSION = 3;
const OPERATIONS = 'operations';
const GROUP_ACCESS = 'groupAccess';
const DIRECTORY_RECORDS = 'directoryRecords';
const HIDDEN_GROUPS = 'hiddenGroups';
const IDENTITY = 'identity';

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
export class IndexedDbOperationStorageV2 implements OperationStorageV2, GroupAccessStorageV2, IdentityStore {
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
                const directory = database.createObjectStore(DIRECTORY_RECORDS, { keyPath: 'recordId' });
                directory.createIndex('directoryId', 'directoryId');
                database.createObjectStore(HIDDEN_GROUPS);
                database.createObjectStore(IDENTITY);
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
        const transaction = (await this.database).transaction([OPERATIONS, GROUP_ACCESS], 'readonly');
        const [records, accessKeys] = await Promise.all([requestResult(
            transaction.objectStore(OPERATIONS).getAll() as IDBRequest<StoredOperationV2[]>,
        ), requestResult(transaction.objectStore(GROUP_ACCESS).getAllKeys())]);
        return [...new Set([...records.map(({ groupId }) => groupId), ...accessKeys.map(String)])].sort();
    }

    async replaceGroups(groups: { access: GroupAccessV2; operations: SignedOperationV2[] }[], directoryRecords: IdentityDirectoryRecord[] = [], identity?: StoredIdentity | null): Promise<void> {
        const validated = groups.map(({ access, operations }) => {
            const parsedAccess = groupAccessV2Schema.parse(access);
            const parsedOperations = operations.map((operation) => signedOperationV2Schema.parse(operation));
            if (parsedOperations.some(({ groupId }) => groupId !== parsedAccess.groupId)) {
                throw new Error('Transferred history belongs to another group');
            }
            deriveGroupStateV2(parsedOperations);
            return { access: parsedAccess, operations: parsedOperations };
        });
        const parsedIdentity = identity ? this.validateIdentity(identity) : identity;
        const parsedDirectoryRecords = directoryRecords.map((record) => parseIdentityDirectoryRecord(record, record.ownerRootPublicKey, record.directoryId));
        const transaction = (await this.database).transaction([OPERATIONS, GROUP_ACCESS, DIRECTORY_RECORDS, HIDDEN_GROUPS, IDENTITY], 'readwrite');
        const done = transactionDone(transaction);
        const operationsStore = transaction.objectStore(OPERATIONS);
        const accessStore = transaction.objectStore(GROUP_ACCESS);
        operationsStore.clear();
        accessStore.clear();
        if (parsedIdentity === null) transaction.objectStore(IDENTITY).clear();
        else if (parsedIdentity) transaction.objectStore(IDENTITY).put(parsedIdentity, 'current');
        transaction.objectStore(DIRECTORY_RECORDS).clear();
        transaction.objectStore(HIDDEN_GROUPS).clear();
        for (const record of parsedDirectoryRecords) transaction.objectStore(DIRECTORY_RECORDS).put(record);
        for (const { access, operations } of validated) {
            accessStore.put(access);
            for (const operation of operations) {
                operationsStore.put({ operationId: operation.operationId, groupId: operation.groupId, operation } satisfies StoredOperationV2);
            }
        }
        await done;
    }

    async deleteGroup(groupId: string): Promise<void> {
        const transaction = (await this.database).transaction([OPERATIONS, GROUP_ACCESS, HIDDEN_GROUPS], 'readwrite');
        transaction.objectStore(HIDDEN_GROUPS).put(true, groupId);
        const store = transaction.objectStore(OPERATIONS);
        const keys = await requestResult(store.index('groupId').getAllKeys(groupId));
        for (const key of keys) store.delete(key);
        transaction.objectStore(GROUP_ACCESS).delete(groupId);
        await transactionDone(transaction);
    }

    async storeGroupAccess(access: GroupAccessV2): Promise<void> {
        const parsed = groupAccessV2Schema.parse(access);
        const transaction = (await this.database).transaction(GROUP_ACCESS, 'readwrite');
        const store = transaction.objectStore(GROUP_ACCESS);
        const existing = await requestResult(store.get(parsed.groupId)) as GroupAccessV2 | undefined;
        if (existing && (existing.groupSecret !== parsed.groupSecret
            || existing.relayGroupCapability !== parsed.relayGroupCapability || existing.relayUrl !== parsed.relayUrl)) {
            throw new Error('Group access conflicts with retained access');
        }
        store.put(parsed);
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

    private validateIdentity(identity: StoredIdentity): StoredIdentity {
        const root = storedRootIdentitySchema.parse(identity.root) as StoredRootIdentity;
        const device = deviceIdentitySchema.parse(identity.device) as StoredIdentity['device'];
        if (device.rootPublicKey !== root.rootKeyPair.publicKey) throw new Error('Device does not belong to stored identity');
        return { root, device };
    }

    async loadIdentity(): Promise<StoredIdentity | null> {
        const transaction = (await this.database).transaction(IDENTITY, 'readonly');
        const stored = await requestResult(transaction.objectStore(IDENTITY).get('current')) as StoredIdentity | undefined;
        return stored ? this.validateIdentity(stored) : null;
    }

    async saveIdentity(identity: StoredIdentity): Promise<void> {
        const parsed = this.validateIdentity(identity);
        const transaction = (await this.database).transaction(IDENTITY, 'readwrite');
        const done = transactionDone(transaction);
        transaction.objectStore(IDENTITY).put(parsed, 'current');
        await done;
    }

    async getDirectoryRecords(directoryId: string): Promise<IdentityDirectoryRecord[]> {
        const transaction = (await this.database).transaction(DIRECTORY_RECORDS, 'readonly');
        const records = await requestResult(transaction.objectStore(DIRECTORY_RECORDS).index('directoryId').getAll(directoryId)) as IdentityDirectoryRecord[];
        return records.map((record) => parseIdentityDirectoryRecord(record, record.ownerRootPublicKey, directoryId));
    }

    async putDirectoryRecords(records: IdentityDirectoryRecord[]): Promise<void> {
        const parsed = records.map((record) => parseIdentityDirectoryRecord(record, record.ownerRootPublicKey, record.directoryId));
        const transaction = (await this.database).transaction(DIRECTORY_RECORDS, 'readwrite');
        const done = transactionDone(transaction);
        for (const record of parsed) transaction.objectStore(DIRECTORY_RECORDS).put(record);
        await done;
    }

    async isGroupHidden(groupId: string): Promise<boolean> {
        const transaction = (await this.database).transaction(HIDDEN_GROUPS, 'readonly');
        return (await requestResult(transaction.objectStore(HIDDEN_GROUPS).get(groupId))) === true;
    }

    async close(): Promise<void> {
        (await this.database).close();
    }
}
