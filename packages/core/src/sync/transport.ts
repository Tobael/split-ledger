// =============================================================================
// SplitLedger — Transport Interface
// =============================================================================
//
// Abstract interface for peer communication.
// Implemented by the authenticated WebSocket relay transport.
//

import type { GroupId } from '../types.js';

/** A single opaque encrypted operation as exchanged over the network. */
export interface TransportEntry {
    operationId: string;
    encryptedOperation: string;
    cursor?: number;
}

/** Handler for incoming operations. */
export type OnEntryHandler = (groupId: GroupId, entry: TransportEntry) => void;

/** Handler for connection state changes */
export type OnConnectionStateHandler = (state: 'connected' | 'disconnected' | 'reconnecting') => void;

/**
 * Transport interface — abstraction over the communication channel.
 * The implementation uses the authenticated WebSocket relay protocol.
 */
export interface Transport {
    /** Connect to the transport for a specific group */
    connect(groupId: GroupId): Promise<void>;

    /** Disconnect from a group */
    disconnect(groupId: GroupId): Promise<void>;

    /** Disconnect from all groups */
    disconnectAll(): Promise<void>;

    /** Publish an encrypted operation to a group. */
    publishEntry(groupId: GroupId, entry: TransportEntry): Promise<void>;

    /** Fetch every currently available operation through cursor pagination. */
    getOperations(groupId: GroupId): Promise<TransportEntry[]>;

    /** Register a handler for incoming operations. */
    onEntry(handler: OnEntryHandler): void;

    /** Register handler for connection state changes */
    onConnectionState(handler: OnConnectionStateHandler): void;

    /** Current connection state */
    readonly connected: boolean;

    /** Get list of currently connected/subscribed groups */
    getConnectedGroups(): GroupId[];
}
