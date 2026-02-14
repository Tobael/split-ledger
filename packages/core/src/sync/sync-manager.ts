// =============================================================================
// SplitLedger — Sync Manager
// =============================================================================
//
// Orchestrates synchronization between local ledger and remote peers.
// Transport-agnostic — works with RelayTransport or future P2PTransport.
//

import type {
    GroupId,
    GroupState,
    Hash,
    LedgerEntry,
    StorageAdapter,
} from '../types.js';
import { validateEntry, applyEntry, orderEntries, validateFullChain } from '../ledger.js';
import { computeBalances } from '../balance.js';
import type { Transport, TransportEntry } from './transport.js';
import {
    deriveGroupKey,
    encryptForRelay,
    decryptFromRelay,
    serializeEntry,
    deserializeEntry,
} from './group-cipher.js';

// ─── Types ───

export interface SyncManagerOptions {
    transport: Transport;
    storage: StorageAdapter;
    syncIntervalMs?: number;
}

export type SyncEventType = 'sync:start' | 'sync:complete' | 'sync:error' | 'entry:received' | 'entry:rejected';

export interface SyncEvent {
    type: SyncEventType;
    groupId: GroupId;
    detail?: unknown;
}

export type SyncEventHandler = (event: SyncEvent) => void;

// ─── Sync Manager ───

export class SyncManager {
    private transport: Transport;
    private storage: StorageAdapter;
    private syncIntervalMs: number;

    /** Group key cache: groupId → { sharedSecret, derivedKey } */
    private groupKeys = new Map<GroupId, Uint8Array>();

    /** Background sync interval handles */
    private syncTimers = new Map<GroupId, ReturnType<typeof setInterval>>();

    /** Event listeners */
    private eventHandlers: SyncEventHandler[] = [];

    constructor(options: SyncManagerOptions) {
        this.transport = options.transport;
        this.storage = options.storage;
        this.syncIntervalMs = options.syncIntervalMs ?? 30000;

        // Listen for pushed entries from transport
        this.transport.onEntry((groupId, entry) => {
            this.handleIncomingEntry(groupId, entry).catch((err) => {
                this.emit({ type: 'sync:error', groupId, detail: err });
            });
        });
    }

    // ─── Group Key Management ───

    /**
     * Register a group's shared secret for encryption.
     * Must be called before syncing a group.
     */
    registerGroupKey(groupId: GroupId, sharedSecret: Uint8Array): void {
        const key = deriveGroupKey(sharedSecret, groupId);
        this.groupKeys.set(groupId, key);
    }

    private getGroupKey(groupId: GroupId): Uint8Array {
        const key = this.groupKeys.get(groupId);
        if (!key) throw new Error(`No group key registered for ${groupId}`);
        return key;
    }

    // ─── Sync Operations ───

    /**
     * Start syncing a group: initial sync + periodic background sync.
     */
    async startSync(groupId: GroupId): Promise<void> {
        await this.transport.connect(groupId);
        await this.syncWithRelay(groupId);
        this.startBackgroundSync(groupId);
    }

    /**
     * Stop syncing a group.
     */
    async stopSync(groupId: GroupId): Promise<void> {
        this.stopBackgroundSync(groupId);
        await this.transport.disconnect(groupId);
    }

    /**
     * Stop all syncing.
     */
    async stopAll(): Promise<void> {
        for (const groupId of this.syncTimers.keys()) {
            this.stopBackgroundSync(groupId);
        }
        await this.transport.disconnectAll();
    }

    /**
     * Sync with relay: fetch entries we're missing.
     */
    async syncWithRelay(groupId: GroupId): Promise<number> {
        this.emit({ type: 'sync:start', groupId });
        const groupKey = this.getGroupKey(groupId);

        try {
            const state = await this.storage.getGroupState(groupId);
            const currentClock = state?.currentLamportClock ?? -1;

            const remoteEntries = await this.transport.getEntriesAfter(groupId, currentClock);
            let accepted = 0;

            for (const transportEntry of remoteEntries) {
                const wasAccepted = await this.processIncomingEntry(groupId, transportEntry, groupKey);
                if (wasAccepted) accepted++;
            }

            this.emit({ type: 'sync:complete', groupId, detail: { accepted, total: remoteEntries.length } });
            return accepted;
        } catch (err) {
            this.emit({ type: 'sync:error', groupId, detail: err });
            throw err;
        }
    }

    /**
     * Full initial sync for a new group.
     * Downloads and validates the entire chain.
     */
    async initialSync(groupId: GroupId): Promise<GroupState | null> {
        this.emit({ type: 'sync:start', groupId });
        const groupKey = this.getGroupKey(groupId);

        try {
            const remoteEntries = await this.transport.getFullLedger(groupId);

            // Decrypt all entries
            const entries: LedgerEntry[] = [];
            for (const te of remoteEntries) {
                try {
                    const encrypted = base64ToBytes(te.encryptedEntry);
                    const decrypted = decryptFromRelay(encrypted, groupKey);
                    const entry = deserializeEntry<LedgerEntry>(decrypted);
                    entries.push(entry);
                } catch {
                    // Skip entries we can't decrypt
                }
            }

            // Validate the full chain
            const result = validateFullChain(entries);
            if (!result.valid) {
                this.emit({ type: 'sync:error', groupId, detail: { errors: result.errors } });
                return null;
            }

            // Store all validated entries
            const ordered = orderEntries(entries);
            for (const entry of ordered) {
                await this.storage.appendEntry(groupId, entry);
            }

            if (result.finalState) {
                await this.storage.saveGroupState(result.finalState);
            }

            this.emit({ type: 'sync:complete', groupId, detail: { accepted: ordered.length } });
            return result.finalState;
        } catch (err) {
            this.emit({ type: 'sync:error', groupId, detail: err });
            throw err;
        }
    }

    /**
     * Broadcast a newly created entry to the relay.
     */
    async broadcastEntry(groupId: GroupId, entry: LedgerEntry): Promise<void> {
        const groupKey = this.getGroupKey(groupId);
        const plaintext = serializeEntry(entry);
        const encrypted = encryptForRelay(plaintext, groupKey);

        const transportEntry: TransportEntry = {
            encryptedEntry: bytesToBase64(encrypted),
            lamportClock: entry.lamportClock,
            senderPubkey: entry.creatorDevicePubkey,
        };

        await this.transport.publishEntry(groupId, transportEntry);
    }

    // ─── Event System ───

    on(handler: SyncEventHandler): void {
        this.eventHandlers.push(handler);
    }

    off(handler: SyncEventHandler): void {
        this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    }

    private emit(event: SyncEvent): void {
        for (const handler of this.eventHandlers) {
            handler(event);
        }
    }

    // ─── Internal: Incoming Entry Processing ───

    private async handleIncomingEntry(groupId: GroupId, transportEntry: TransportEntry): Promise<void> {
        const groupKey = this.groupKeys.get(groupId);
        if (!groupKey) return;

        await this.processIncomingEntry(groupId, transportEntry, groupKey);
    }

    private async processIncomingEntry(
        groupId: GroupId,
        transportEntry: TransportEntry,
        groupKey: Uint8Array,
    ): Promise<boolean> {
        // Decrypt
        let entry: LedgerEntry;
        try {
            const encrypted = base64ToBytes(transportEntry.encryptedEntry);
            const decrypted = decryptFromRelay(encrypted, groupKey);
            entry = deserializeEntry<LedgerEntry>(decrypted);
        } catch (err) {
            console.error('[SyncManager] Decryption/Deserialization failed:', err);
            this.emit({ type: 'entry:rejected', groupId, detail: { reason: 'Decryption failed', error: err } });
            return false;
        }

        // Check for duplicates
        const existing = await this.storage.getEntry(entry.entryId);
        if (existing) return false;

        // Validate
        const allEntries = await this.storage.getAllEntries(groupId);
        const state = await this.storage.getGroupState(groupId);

        if (!state) {
            // No state yet — this might be the genesis entry
            if (entry.entryType !== 'Genesis') {
                console.error('[SyncManager] Rejected: Expected genesis entry first, got', entry.entryType, entry.lamportClock);
                this.emit({ type: 'entry:rejected', groupId, detail: { reason: 'Expected genesis first', entryId: entry.entryId } });
                return false;
            }
        }

        const emptyState = state ?? createMinimalGroupState(groupId);
        const result = validateEntry(entry, allEntries, emptyState);

        if (!result.valid) {
            console.error('[SyncManager] Validation failed:', result.errors);
            this.emit({ type: 'entry:rejected', groupId, detail: { errors: result.errors, entryId: entry.entryId } });
            return false;
        }

        // Append and update state
        await this.storage.appendEntry(groupId, entry);
        applyEntry(entry, emptyState);

        // Recompute balances
        const updatedEntries = await this.storage.getAllEntries(groupId);
        emptyState.balances = computeBalances(orderEntries(updatedEntries));
        await this.storage.saveGroupState(emptyState);

        this.emit({ type: 'entry:received', groupId, detail: { entryId: entry.entryId } });
        return true;
    }

    // ─── Background Sync ───

    private startBackgroundSync(groupId: GroupId): void {
        if (this.syncTimers.has(groupId)) return;

        const timer = setInterval(() => {
            this.syncWithRelay(groupId).catch((err) => {
                this.emit({ type: 'sync:error', groupId, detail: err });
            });
        }, this.syncIntervalMs);

        this.syncTimers.set(groupId, timer);
    }

    private stopBackgroundSync(groupId: GroupId): void {
        const timer = this.syncTimers.get(groupId);
        if (timer) {
            clearInterval(timer);
            this.syncTimers.delete(groupId);
        }
    }
}

// ─── Helpers ───

function createMinimalGroupState(groupId: GroupId): GroupState {
    return {
        groupId,
        groupName: '',
        creatorRootPubkey: '' as any,
        members: new Map(),
        latestEntryHash: '' as Hash,
        currentLamportClock: 0,
        balances: new Map(),
    };
}

function bytesToBase64(bytes: Uint8Array): string {
    // Works in both browser and Node
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(b64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    return new Uint8Array(atob(b64).split('').map((c) => c.charCodeAt(0)));
}
