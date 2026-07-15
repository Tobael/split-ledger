// =============================================================================
// Sync Manager Unit Tests (Mock Transport)
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SyncManager, type SyncEvent } from '../sync/sync-manager.js';
import type { Transport, TransportEntry, OnEntryHandler, OnConnectionStateHandler } from '../sync/transport.js';
import { InMemoryStorageAdapter } from '../storage.js';
import { buildEntry } from '../ledger.js';
import { createRootIdentity, createDeviceIdentity, generateGroupId } from '../identity.js';
import { encryptForRelay, deriveGroupKey, serializeEntry } from '../sync/group-cipher.js';
import { EntryType } from '../types.js';
import type { GroupId, LedgerEntry } from '../types.js';

// ─── Mock Transport ───

class MockTransport implements Transport {
    connected = false;
    private entryHandlers: OnEntryHandler[] = [];
    private connectionStateHandlers: OnConnectionStateHandler[] = [];

    // Stored entries for mock responses
    storedEntries = new Map<GroupId, TransportEntry[]>();

    async connect(_groupId: GroupId): Promise<void> {
        this.connected = true;
    }
    async disconnect(_groupId: GroupId): Promise<void> {
        this.connected = false;
    }
    async disconnectAll(): Promise<void> {
        this.connected = false;
    }

    publishedEntries: Array<{ groupId: GroupId; entry: TransportEntry }> = [];

    async publishEntry(groupId: GroupId, entry: TransportEntry): Promise<void> {
        this.publishedEntries.push({ groupId, entry });
    }

    async getOperations(groupId: GroupId): Promise<TransportEntry[]> {
        return this.storedEntries.get(groupId) ?? [];
    }

    onEntry(handler: OnEntryHandler): void {
        this.entryHandlers.push(handler);
    }

    onConnectionState(handler: OnConnectionStateHandler): void {
        this.connectionStateHandlers.push(handler);
    }

    // Test helper: simulate incoming entry
    simulateIncomingEntry(groupId: GroupId, entry: TransportEntry): void {
        for (const handler of this.entryHandlers) {
            handler(groupId, entry);
        }
    }
}

// ─── Helpers ───

function encryptEntry(entry: LedgerEntry, groupKey: Uint8Array): string {
    const plaintext = serializeEntry(entry);
    const encrypted = encryptForRelay(plaintext, groupKey);
    return Buffer.from(encrypted).toString('base64');
}

function encryptUnknown(value: unknown, groupKey: Uint8Array): string {
    const encrypted = encryptForRelay(serializeEntry(value), groupKey);
    return Buffer.from(encrypted).toString('base64');
}

// ─── Tests ───

describe('SyncManager', () => {
    let transport: MockTransport;
    let storage: InMemoryStorageAdapter;
    let syncManager: SyncManager;
    let groupId: GroupId;
    let groupKey: Uint8Array;
    const sharedSecret = new Uint8Array(32).fill(0xab);

    beforeEach(() => {
        transport = new MockTransport();
        storage = new InMemoryStorageAdapter();
        syncManager = new SyncManager({ transport, storage, syncIntervalMs: 60000 });
        groupId = generateGroupId();
        groupKey = deriveGroupKey(sharedSecret, groupId);
        syncManager.registerGroupKey(groupId, sharedSecret);
    });

    describe('broadcastEntry', () => {
        it('encrypts and publishes entry to transport', async () => {
            const root = createRootIdentity('Alice');
            const device = createDeviceIdentity(root.rootKeyPair, 'iPhone');

            const genesis = buildEntry(
                EntryType.Genesis,
                {
                    groupId,
                    groupName: 'Test',
                    creatorRootPubkey: root.rootKeyPair.publicKey,
                    creatorDisplayName: 'Alice',
                },
                null, 0,
                device.deviceKeyPair.publicKey,
                device.deviceKeyPair.secretKey,
                1000,
            );

            await syncManager.broadcastEntry(groupId, genesis);

            expect(transport.publishedEntries).toHaveLength(1);
            expect(transport.publishedEntries[0]!.groupId).toBe(groupId);
            expect(transport.publishedEntries[0]!.entry.operationId).toBe(genesis.entryId);
            expect(transport.publishedEntries[0]!.entry.encryptedOperation.length).toBeGreaterThan(0);
        });
    });

    describe('syncWithRelay', () => {
        it('fetches and validates remote entries', async () => {
            const root = createRootIdentity('Alice');
            const device = createDeviceIdentity(root.rootKeyPair, 'iPhone');

            const genesis = buildEntry(
                EntryType.Genesis,
                {
                    groupId,
                    groupName: 'Test',
                    creatorRootPubkey: root.rootKeyPair.publicKey,
                    creatorDisplayName: 'Alice',
                },
                null, 0,
                device.deviceKeyPair.publicKey,
                device.deviceKeyPair.secretKey,
                1000,
            );

            // Put encrypted entries in mock transport
            transport.storedEntries.set(groupId, [
                {
                    operationId: genesis.entryId,
                    encryptedOperation: encryptEntry(genesis, groupKey),
                },
            ]);

            const accepted = await syncManager.syncWithRelay(groupId);
            expect(accepted).toBe(1);

            // Verify stored
            const entries = await storage.getAllEntries(groupId);
            expect(entries).toHaveLength(1);
            expect(entries[0]!.entryId).toBe(genesis.entryId);
        });

        it('skips duplicate entries', async () => {
            const root = createRootIdentity('Alice');
            const device = createDeviceIdentity(root.rootKeyPair, 'iPhone');

            const genesis = buildEntry(
                EntryType.Genesis,
                { groupId, groupName: 'Test', creatorRootPubkey: root.rootKeyPair.publicKey, creatorDisplayName: 'Alice' },
                null, 0, device.deviceKeyPair.publicKey, device.deviceKeyPair.secretKey, 1000,
            );

            // Store locally first
            await storage.appendEntry(groupId, genesis);

            // Same entry comes from relay
            transport.storedEntries.set(groupId, [
                { operationId: genesis.entryId, encryptedOperation: encryptEntry(genesis, groupKey) },
            ]);

            const accepted = await syncManager.syncWithRelay(groupId);
            expect(accepted).toBe(0); // no new entries accepted

            const entries = await storage.getAllEntries(groupId);
            expect(entries).toHaveLength(1); // still just one
        });

        it('repopulates an empty relay from durable local history', async () => {
            const root = createRootIdentity('Alice');
            const device = createDeviceIdentity(root.rootKeyPair, 'iPhone');
            const genesis = buildEntry(
                EntryType.Genesis,
                { groupId, groupName: 'Test', creatorRootPubkey: root.rootKeyPair.publicKey, creatorDisplayName: 'Alice' },
                null, 0, device.deviceKeyPair.publicKey, device.deviceKeyPair.secretKey, 1000,
            );
            await storage.appendEntry(groupId, genesis);
            transport.storedEntries.set(groupId, []);

            const accepted = await syncManager.syncWithRelay(groupId);

            expect(accepted).toBe(0);
            expect(transport.publishedEntries).toHaveLength(1);
            expect(transport.publishedEntries[0]!.entry.operationId).toBe(genesis.entryId);
        });

        it('rejects decrypted data that is not a structurally valid entry', async () => {
            const events: SyncEvent[] = [];
            syncManager.on((event) => events.push(event));
            transport.storedEntries.set(groupId, [{
                operationId: '0'.repeat(64),
                encryptedOperation: encryptUnknown({ entryType: EntryType.Genesis }, groupKey),
            }]);

            const accepted = await syncManager.syncWithRelay(groupId);

            expect(accepted).toBe(0);
            expect(await storage.getAllEntries(groupId)).toHaveLength(0);
            expect(events.some((event) => event.type === 'entry:rejected')).toBe(true);
        });
    });

    describe('history availability', () => {
        it('reports that an invited group needs an online member when the relay is empty', async () => {
            const events: SyncEvent[] = [];
            syncManager.on((event) => events.push(event));
            transport.storedEntries.set(groupId, []);

            expect(await syncManager.initialSync(groupId, { expectHistory: true })).toBeNull();
            expect(events.some((event) => event.type === 'history:missing')).toBe(true);
        });

        it('does not report missing history for a new local group before genesis is created', async () => {
            const events: SyncEvent[] = [];
            syncManager.on((event) => events.push(event));
            transport.storedEntries.set(groupId, []);

            expect(await syncManager.initialSync(groupId)).toBeNull();
            expect(events.some((event) => event.type === 'history:missing')).toBe(false);
        });

        it('reports history available after an online member seeds the relay', async () => {
            const root = createRootIdentity('Alice');
            const device = createDeviceIdentity(root.rootKeyPair, 'iPhone');
            const genesis = buildEntry(
                EntryType.Genesis,
                { groupId, groupName: 'Test', creatorRootPubkey: root.rootKeyPair.publicKey, creatorDisplayName: 'Alice' },
                null, 0, device.deviceKeyPair.publicKey, device.deviceKeyPair.secretKey, 1000,
            );
            const events: SyncEvent[] = [];
            syncManager.on((event) => events.push(event));
            transport.storedEntries.set(groupId, []);
            await syncManager.initialSync(groupId, { expectHistory: true });
            transport.storedEntries.set(groupId, [{
                operationId: genesis.entryId,
                encryptedOperation: encryptEntry(genesis, groupKey),
            }]);

            await syncManager.syncWithRelay(groupId);

            expect(events.some((event) => event.type === 'history:missing')).toBe(true);
            expect(events.some((event) => event.type === 'history:available')).toBe(true);
        });
    });

    describe('event system', () => {
        it('emits sync events', async () => {
            const events: SyncEvent[] = [];
            syncManager.on((e) => events.push(e));

            transport.storedEntries.set(groupId, []);
            await syncManager.syncWithRelay(groupId);

            expect(events.some((e) => e.type === 'sync:start')).toBe(true);
            expect(events.some((e) => e.type === 'sync:complete')).toBe(true);
        });

        it('can remove event handlers', async () => {
            const events: SyncEvent[] = [];
            const handler = (e: SyncEvent) => events.push(e);
            syncManager.on(handler);
            syncManager.off(handler);

            transport.storedEntries.set(groupId, []);
            await syncManager.syncWithRelay(groupId);

            expect(events).toHaveLength(0);
        });
    });

    describe('incoming entry handling', () => {
        it('processes pushed entries from transport', async () => {
            const root = createRootIdentity('Alice');
            const device = createDeviceIdentity(root.rootKeyPair, 'iPhone');

            const genesis = buildEntry(
                EntryType.Genesis,
                { groupId, groupName: 'Test', creatorRootPubkey: root.rootKeyPair.publicKey, creatorDisplayName: 'Alice' },
                null, 0, device.deviceKeyPair.publicKey, device.deviceKeyPair.secretKey, 1000,
            );

            const events: SyncEvent[] = [];
            syncManager.on((e) => events.push(e));

            // Simulate incoming entry from transport
            transport.simulateIncomingEntry(groupId, {
                operationId: genesis.entryId,
                encryptedOperation: encryptEntry(genesis, groupKey),
            });

            // Wait for async processing
            await new Promise((r) => setTimeout(r, 100));

            const entries = await storage.getAllEntries(groupId);
            expect(entries).toHaveLength(1);
            expect(events.some((e) => e.type === 'entry:received')).toBe(true);
        });
    });

    describe('startSync / stopSync', () => {
        it('connects transport on startSync', async () => {
            transport.storedEntries.set(groupId, []);
            await syncManager.startSync(groupId);
            expect(transport.connected).toBe(true);
            await syncManager.stopSync(groupId);
        });

        it('stopAll disconnects everything', async () => {
            transport.storedEntries.set(groupId, []);
            await syncManager.startSync(groupId);
            await syncManager.stopAll();
            expect(transport.connected).toBe(false);
        });
    });
});
