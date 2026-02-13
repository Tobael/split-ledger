// =============================================================================
// Sync Manager Unit Tests (Mock Transport)
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncManager, type SyncEvent } from '../sync/sync-manager.js';
import type { Transport, TransportEntry, OnEntryHandler, OnConnectionStateHandler } from '../sync/transport.js';
import { InMemoryStorageAdapter } from '../storage.js';
import { buildEntry, validateFullChain } from '../ledger.js';
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

    async getEntriesAfter(groupId: GroupId, afterLamportClock: number): Promise<TransportEntry[]> {
        const entries = this.storedEntries.get(groupId) ?? [];
        return entries.filter((e) => e.lamportClock > afterLamportClock);
    }

    async getFullLedger(groupId: GroupId): Promise<TransportEntry[]> {
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
            expect(transport.publishedEntries[0]!.entry.lamportClock).toBe(0);
            expect(transport.publishedEntries[0]!.entry.senderPubkey).toBe(device.deviceKeyPair.publicKey);
            // The encrypted entry should be non-empty base64
            expect(transport.publishedEntries[0]!.entry.encryptedEntry.length).toBeGreaterThan(0);
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
                    encryptedEntry: encryptEntry(genesis, groupKey),
                    lamportClock: genesis.lamportClock,
                    senderPubkey: genesis.creatorDevicePubkey,
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
                { encryptedEntry: encryptEntry(genesis, groupKey), lamportClock: 0, senderPubkey: genesis.creatorDevicePubkey },
            ]);

            const accepted = await syncManager.syncWithRelay(groupId);
            expect(accepted).toBe(0); // no new entries accepted

            const entries = await storage.getAllEntries(groupId);
            expect(entries).toHaveLength(1); // still just one
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
                encryptedEntry: encryptEntry(genesis, groupKey),
                lamportClock: 0,
                senderPubkey: genesis.creatorDevicePubkey,
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
