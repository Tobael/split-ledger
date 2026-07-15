// =============================================================================
// SplitLedger — Sync Manager
// =============================================================================
//
// Orchestrates synchronization between local ledger and remote peers.
// Uses the authenticated relay transport boundary.
//

import type {
    GroupId,
    GroupState,
    Hash,
    LedgerEntry,
    StorageAdapter,
} from '../types.js';
import { EntryType } from '../types.js';
import { validateEntry, applyEntry, orderEntries, validateFullChain } from '../ledger.js';
import { computeBalances } from '../balance.js';
import { parseLedgerEntry } from '../schemas.js';
import type { Transport, TransportEntry } from './transport.js';
import {
    deriveGroupKey,
    encryptForRelay,
    decryptFromRelay,
    serializeEntry,
} from './group-cipher.js';

// ─── Types ───

export interface SyncManagerOptions {
    transport: Transport;
    storage: StorageAdapter;
    syncIntervalMs?: number;
}

export type SyncEventType =
    | 'sync:start'
    | 'sync:complete'
    | 'sync:error'
    | 'entry:received'
    | 'entry:rejected'
    | 'history:missing'
    | 'history:available';

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
        try {
            await this.transport.connect(groupId);
            await this.syncWithRelay(groupId);
        } finally {
            this.startBackgroundSync(groupId);
        }
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
     * Delete a group locally and stop syncing it.
     */
    async deleteGroup(groupId: GroupId): Promise<void> {
        this.stopBackgroundSync(groupId);
        await this.transport.disconnect(groupId);
        await this.storage.deleteGroup(groupId);
    }

    /**
     * Sync with relay: fetch entries we're missing.
     */
    async syncWithRelay(groupId: GroupId): Promise<number> {
        this.emit({ type: 'sync:start', groupId });
        const groupKey = this.getGroupKey(groupId);

        try {
            const remoteEntries = await this.transport.getOperations(groupId);
            let accepted = 0;

            for (const transportEntry of remoteEntries) {
                const wasAccepted = await this.processIncomingEntry(groupId, transportEntry, groupKey);
                if (wasAccepted) accepted++;
            }

            // Relays are disposable rendezvous caches. Re-advertise durable local
            // history on every successful pass so one complete member can seed an
            // empty, replaced, or pruned relay. Publication is idempotent by ID.
            const localEntries = await this.storage.getAllEntries(groupId);
            for (const entry of localEntries) {
                await this.broadcastEntry(groupId, entry);
            }
            const chain = validateFullChain(localEntries);
            if (chain.valid && chain.finalState) {
                this.emit({ type: 'history:available', groupId });
            } else if (hasMissingHistory(localEntries)) {
                this.emit({ type: 'history:missing', groupId, detail: { reason: 'Required ancestor unavailable' } });
            }

            this.emit({
                type: 'sync:complete',
                groupId,
                detail: { accepted, received: remoteEntries.length, advertised: localEntries.length },
            });
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
    async initialSync(groupId: GroupId, options: { expectHistory?: boolean } = {}): Promise<GroupState | null> {
        this.emit({ type: 'sync:start', groupId });
        await this.transport.connect(groupId);
        const groupKey = this.getGroupKey(groupId);

        try {
            const remoteEntries = await this.transport.getOperations(groupId);

            if (remoteEntries.length === 0 && (await this.storage.getAllEntries(groupId)).length === 0) {
                if (options.expectHistory) {
                    this.emit({ type: 'history:missing', groupId, detail: { reason: 'Relay has no group history' } });
                }
                this.emit({ type: 'sync:complete', groupId, detail: { accepted: 0, received: 0 } });
                return null;
            }

            // Decrypt all entries
            const entries: LedgerEntry[] = [];
            for (const te of remoteEntries) {
                try {
                    const encrypted = base64ToBytes(te.encryptedOperation);
                    const decrypted = decryptFromRelay(encrypted, groupKey);
                    const entry = parseLedgerEntry(decrypted);
                    if (te.operationId === entry.entryId) entries.push(entry);
                    else this.emit({ type: 'entry:rejected', groupId, detail: { reason: 'Relay operation ID mismatch' } });
                } catch (error) {
                    this.emit({ type: 'entry:rejected', groupId, detail: { reason: 'Invalid encrypted entry', error } });
                }
            }

            // Validate the full chain
            const result = validateFullChain(entries);
            if (!result.valid) {
                if (hasMissingHistory(entries)) {
                    this.emit({ type: 'history:missing', groupId, detail: { reason: 'Required ancestor unavailable' } });
                }
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
                this.emit({ type: 'history:available', groupId });
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
            operationId: entry.entryId,
            encryptedOperation: bytesToBase64(encrypted),
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
            const encrypted = base64ToBytes(transportEntry.encryptedOperation);
            const decrypted = decryptFromRelay(encrypted, groupKey);
            entry = parseLedgerEntry(decrypted);
        } catch (err) {
            this.emit({ type: 'entry:rejected', groupId, detail: { reason: 'Invalid encrypted entry', error: err } });
            return false;
        }

        if (transportEntry.operationId !== entry.entryId) {
            this.emit({ type: 'entry:rejected', groupId, detail: { reason: 'Relay operation ID mismatch' } });
            return false;
        }

        // Check for duplicates
        const existing = await this.storage.getEntry(entry.entryId);
        if (existing) {
            return false;
        }

        // Validate
        const allEntries = await this.storage.getAllEntries(groupId);
        const state = await this.storage.getGroupState(groupId);

        if (!state) {
            // No state yet — this might be the genesis entry
            if (entry.entryType !== 'Genesis') {
                this.emit({ type: 'history:missing', groupId, detail: { reason: 'Genesis operation unavailable' } });
                this.emit({ type: 'entry:rejected', groupId, detail: { reason: 'Expected genesis first', entryId: entry.entryId } });
                return false;
            }
        }

        const emptyState = state ?? createMinimalGroupState(groupId);
        const result = validateEntry(entry, allEntries, emptyState);

        if (!result.valid) {
            if (result.errors.some(({ field }) => field === 'previousHash')) {
                this.emit({ type: 'history:missing', groupId, detail: { reason: 'Required ancestor unavailable' } });
            }
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

function hasMissingHistory(entries: readonly LedgerEntry[]): boolean {
    if (entries.length === 0) return false;
    const ids = new Set(entries.map(({ entryId }) => entryId));
    return !entries.some(({ entryType }) => entryType === EntryType.Genesis)
        || entries.some(({ previousHash }) => previousHash !== null && !ids.has(previousHash));
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
