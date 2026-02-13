// =============================================================================
// SplitLedger — Composite Transport
// =============================================================================
//
// Wraps both RelayTransport and P2PTransport:
// - Publishes to both (P2P for online peers, relay for offline)
// - Fetches via relay (authoritative source) with P2P as supplement
// - Deduplicates incoming entries from both transports
//

import type { GroupId } from '../types.js';
import type {
    Transport,
    TransportEntry,
    OnEntryHandler,
    OnConnectionStateHandler,
} from './transport.js';

export interface CompositeTransportOptions {
    relay: Transport;
    p2p: Transport;
}

export class CompositeTransport implements Transport {
    private relay: Transport;
    private p2p: Transport;
    private entryHandlers: OnEntryHandler[] = [];
    private connectionStateHandlers: OnConnectionStateHandler[] = [];

    /** Dedup: track recently seen entries to avoid double-processing */
    private seenEntries = new Set<string>();
    private readonly maxSeenSize = 10000;

    constructor(options: CompositeTransportOptions) {
        this.relay = options.relay;
        this.p2p = options.p2p;

        // Wire up incoming entries from both transports with dedup
        this.relay.onEntry((groupId, entry) => this.handleIncoming(groupId, entry));
        this.p2p.onEntry((groupId, entry) => this.handleIncoming(groupId, entry));

        // Forward connection state from relay (primary)
        this.relay.onConnectionState((state) => {
            for (const handler of this.connectionStateHandlers) {
                handler(state);
            }
        });
    }

    get connected(): boolean {
        return this.relay.connected || this.p2p.connected;
    }

    // ─── Connection Management ───

    async connect(groupId: GroupId): Promise<void> {
        // Connect relay (required) and P2P (best-effort)
        await this.relay.connect(groupId);
        try {
            await this.p2p.connect(groupId);
        } catch {
            // P2P is optional; relay is sufficient
        }
    }

    async disconnect(groupId: GroupId): Promise<void> {
        await Promise.all([
            this.relay.disconnect(groupId),
            this.p2p.disconnect(groupId).catch(() => { }),
        ]);
    }

    async disconnectAll(): Promise<void> {
        await Promise.all([
            this.relay.disconnectAll(),
            this.p2p.disconnectAll().catch(() => { }),
        ]);
    }

    // ─── Entry Operations ───

    async publishEntry(groupId: GroupId, entry: TransportEntry): Promise<void> {
        // Publish to both transports in parallel
        // Mark as seen so we don't echo back to ourselves
        this.markSeen(groupId, entry);

        await Promise.all([
            this.relay.publishEntry(groupId, entry),
            this.p2p.publishEntry(groupId, entry).catch(() => { }),
        ]);
    }

    async getEntriesAfter(groupId: GroupId, afterLamportClock: number): Promise<TransportEntry[]> {
        // Relay is authoritative; use it for gap-fill queries
        return this.relay.getEntriesAfter(groupId, afterLamportClock);
    }

    async getFullLedger(groupId: GroupId): Promise<TransportEntry[]> {
        // Relay is authoritative; use it for full ledger
        return this.relay.getFullLedger(groupId);
    }

    // ─── Event Handlers ───

    onEntry(handler: OnEntryHandler): void {
        this.entryHandlers.push(handler);
    }

    onConnectionState(handler: OnConnectionStateHandler): void {
        this.connectionStateHandlers.push(handler);
    }

    // ─── Internal ───

    private handleIncoming(groupId: GroupId, entry: TransportEntry): void {
        const key = this.entryKey(groupId, entry);

        if (this.seenEntries.has(key)) {
            return; // Already processed from the other transport
        }

        this.markSeen(groupId, entry);

        for (const handler of this.entryHandlers) {
            handler(groupId, entry);
        }
    }

    private markSeen(groupId: GroupId, entry: TransportEntry): void {
        const key = this.entryKey(groupId, entry);
        this.seenEntries.add(key);

        // Prevent unbounded growth
        if (this.seenEntries.size > this.maxSeenSize) {
            const iter = this.seenEntries.values();
            for (let i = 0; i < 1000; i++) {
                const next = iter.next();
                if (next.done) break;
                this.seenEntries.delete(next.value);
            }
        }
    }

    private entryKey(groupId: GroupId, entry: TransportEntry): string {
        return `${groupId}:${entry.lamportClock}:${entry.senderPubkey}:${entry.encryptedEntry.slice(0, 32)}`;
    }
}
