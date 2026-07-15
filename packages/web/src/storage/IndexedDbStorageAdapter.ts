import type {
    DeviceIdentity,
    GroupId,
    GroupState,
    Hash,
    LedgerEntry,
    RootIdentity,
    StorageAdapter,
} from '@splitledger/core';
import { orderEntries } from '@splitledger/core';

const DATABASE_NAME = 'fair-money';
const DATABASE_VERSION = 1;
const ENTRIES = 'entries';
const GROUP_STATES = 'groupStates';
const IDENTITIES = 'identities';

interface StoredEntry {
    entryId: Hash;
    groupId: GroupId;
    entry: LedgerEntry;
}

interface StoredIdentity<T> {
    kind: 'root' | 'device';
    value: T;
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

export class IndexedDbStorageAdapter implements StorageAdapter {
    private readonly database: Promise<IDBDatabase>;

    constructor(databaseName = DATABASE_NAME) {
        this.database = this.open(databaseName);
    }

    private open(databaseName: string): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, DATABASE_VERSION);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(ENTRIES)) {
                    const entries = database.createObjectStore(ENTRIES, { keyPath: 'entryId' });
                    entries.createIndex('groupId', 'groupId', { unique: false });
                }
                if (!database.objectStoreNames.contains(GROUP_STATES)) {
                    database.createObjectStore(GROUP_STATES, { keyPath: 'groupId' });
                }
                if (!database.objectStoreNames.contains(IDENTITIES)) {
                    database.createObjectStore(IDENTITIES, { keyPath: 'kind' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
            request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another Fair Money tab'));
        });
    }

    private async transaction(storeNames: string | string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
        return (await this.database).transaction(storeNames, mode);
    }

    async appendEntry(groupId: GroupId, entry: LedgerEntry): Promise<void> {
        const transaction = await this.transaction(ENTRIES, 'readwrite');
        transaction.objectStore(ENTRIES).put({ entryId: entry.entryId, groupId, entry } satisfies StoredEntry);
        await transactionDone(transaction);
    }

    async getEntry(entryId: Hash): Promise<LedgerEntry | null> {
        const transaction = await this.transaction(ENTRIES, 'readonly');
        const stored = await requestResult(transaction.objectStore(ENTRIES).get(entryId) as IDBRequest<StoredEntry | undefined>);
        return stored?.entry ?? null;
    }

    async getEntriesAfter(groupId: GroupId, afterLamportClock: number): Promise<LedgerEntry[]> {
        return (await this.getAllEntries(groupId)).filter((entry) => entry.lamportClock > afterLamportClock);
    }

    async getLatestEntry(groupId: GroupId): Promise<LedgerEntry | null> {
        const entries = await this.getAllEntries(groupId);
        return entries.at(-1) ?? null;
    }

    async getAllEntries(groupId: GroupId): Promise<LedgerEntry[]> {
        const transaction = await this.transaction(ENTRIES, 'readonly');
        const records = await requestResult(
            transaction.objectStore(ENTRIES).index('groupId').getAll(groupId) as IDBRequest<StoredEntry[]>,
        );
        return orderEntries(records.map((record) => record.entry));
    }

    async storeRootIdentity(identity: RootIdentity): Promise<void> {
        await this.storeIdentity({ kind: 'root', value: identity });
    }

    async getRootIdentity(): Promise<RootIdentity | null> {
        return this.getIdentity<RootIdentity>('root');
    }

    async storeDeviceIdentity(identity: DeviceIdentity): Promise<void> {
        await this.storeIdentity({ kind: 'device', value: identity });
    }

    async getDeviceIdentity(): Promise<DeviceIdentity | null> {
        return this.getIdentity<DeviceIdentity>('device');
    }

    async clearIdentity(): Promise<void> {
        const transaction = await this.transaction(IDENTITIES, 'readwrite');
        transaction.objectStore(IDENTITIES).clear();
        await transactionDone(transaction);
    }

    private async storeIdentity<T>(identity: StoredIdentity<T>): Promise<void> {
        const transaction = await this.transaction(IDENTITIES, 'readwrite');
        transaction.objectStore(IDENTITIES).put(identity);
        await transactionDone(transaction);
    }

    private async getIdentity<T>(kind: StoredIdentity<T>['kind']): Promise<T | null> {
        const transaction = await this.transaction(IDENTITIES, 'readonly');
        const identity = await requestResult(
            transaction.objectStore(IDENTITIES).get(kind) as IDBRequest<StoredIdentity<T> | undefined>,
        );
        return identity?.value ?? null;
    }

    async getGroupIds(): Promise<GroupId[]> {
        const transaction = await this.transaction(ENTRIES, 'readonly');
        const records = await requestResult(transaction.objectStore(ENTRIES).getAll() as IDBRequest<StoredEntry[]>);
        return [...new Set(records.map((record) => record.groupId))];
    }

    async getGroupState(groupId: GroupId): Promise<GroupState | null> {
        const transaction = await this.transaction(GROUP_STATES, 'readonly');
        return await requestResult(
            transaction.objectStore(GROUP_STATES).get(groupId) as IDBRequest<GroupState | undefined>,
        ) ?? null;
    }

    async saveGroupState(state: GroupState): Promise<void> {
        const transaction = await this.transaction(GROUP_STATES, 'readwrite');
        transaction.objectStore(GROUP_STATES).put(state);
        await transactionDone(transaction);
    }

    async deleteGroup(groupId: GroupId): Promise<void> {
        const transaction = await this.transaction([ENTRIES, GROUP_STATES], 'readwrite');
        const entries = transaction.objectStore(ENTRIES);
        const keys = await requestResult(entries.index('groupId').getAllKeys(groupId));
        for (const key of keys) entries.delete(key);
        transaction.objectStore(GROUP_STATES).delete(groupId);
        await transactionDone(transaction);
    }
}
