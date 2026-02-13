// =============================================================================
// SplitLedger — Transport Interface
// =============================================================================
//
// Abstract interface for peer communication.
// Implementations: RelayTransport (WebSocket), P2PTransport (libp2p, future)
//

import type { GroupId } from '../types.js';

/** A single encrypted entry as exchanged over the network */
export interface TransportEntry {
    encryptedEntry: string; // base64-encoded encrypted data
    lamportClock: number;
    senderPubkey: string;
}

/** Handler for incoming entries */
export type OnEntryHandler = (groupId: GroupId, entry: TransportEntry) => void;

/** Handler for connection state changes */
export type OnConnectionStateHandler = (state: 'connected' | 'disconnected' | 'reconnecting') => void;

/**
 * Transport interface — abstraction over the communication channel.
 * All methods are async to accommodate both WebSocket and P2P transports.
 */
export interface Transport {
    /** Connect to the transport for a specific group */
    connect(groupId: GroupId): Promise<void>;

    /** Disconnect from a group */
    disconnect(groupId: GroupId): Promise<void>;

    /** Disconnect from all groups */
    disconnectAll(): Promise<void>;

    /** Publish an encrypted entry to a group */
    publishEntry(groupId: GroupId, entry: TransportEntry): Promise<void>;

    /** Fetch entries after a given Lamport clock */
    getEntriesAfter(groupId: GroupId, afterLamportClock: number): Promise<TransportEntry[]>;

    /** Fetch the full ledger for initial sync */
    getFullLedger(groupId: GroupId): Promise<TransportEntry[]>;

    /** Register handler for incoming entries */
    onEntry(handler: OnEntryHandler): void;

    /** Register handler for connection state changes */
    onConnectionState(handler: OnConnectionStateHandler): void;

    /** Current connection state */
    readonly connected: boolean;
}
