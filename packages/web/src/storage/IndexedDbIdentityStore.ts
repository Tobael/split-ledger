import type { DeviceIdentity, RootIdentity } from '@splitledger/core';
import type { IdentityStore } from './IdentityStore';

const DATABASE_NAME = 'fair-money-identity';
const DATABASE_VERSION = 1;
const IDENTITIES = 'identities';

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

export class IndexedDbIdentityStore implements IdentityStore {
    private readonly database: Promise<IDBDatabase>;

    constructor(databaseName = DATABASE_NAME) {
        this.database = new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, DATABASE_VERSION);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(IDENTITIES)) {
                    request.result.createObjectStore(IDENTITIES, { keyPath: 'kind' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('Unable to open identity storage'));
            request.onblocked = () => reject(new Error('Identity storage upgrade is blocked by another Fair Money tab'));
        });
    }

    async storeRootIdentity(identity: RootIdentity): Promise<void> {
        await this.store({ kind: 'root', value: identity });
    }

    async getRootIdentity(): Promise<RootIdentity | null> {
        return this.get<RootIdentity>('root');
    }

    async storeDeviceIdentity(identity: DeviceIdentity): Promise<void> {
        await this.store({ kind: 'device', value: identity });
    }

    async getDeviceIdentity(): Promise<DeviceIdentity | null> {
        return this.get<DeviceIdentity>('device');
    }

    async clearIdentity(): Promise<void> {
        const transaction = (await this.database).transaction(IDENTITIES, 'readwrite');
        transaction.objectStore(IDENTITIES).clear();
        await transactionDone(transaction);
    }

    private async store<T>(identity: StoredIdentity<T>): Promise<void> {
        const transaction = (await this.database).transaction(IDENTITIES, 'readwrite');
        transaction.objectStore(IDENTITIES).put(identity);
        await transactionDone(transaction);
    }

    private async get<T>(kind: StoredIdentity<T>['kind']): Promise<T | null> {
        const transaction = (await this.database).transaction(IDENTITIES, 'readonly');
        const identity = await requestResult(
            transaction.objectStore(IDENTITIES).get(kind) as IDBRequest<StoredIdentity<T> | undefined>,
        );
        return identity?.value ?? null;
    }
}
