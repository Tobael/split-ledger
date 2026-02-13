// =============================================================================
// SplitLedger — Sync Module Public API
// =============================================================================

export type {
    Transport,
    TransportEntry,
    OnEntryHandler,
    OnConnectionStateHandler,
} from './transport.js';

export {
    deriveGroupKey,
    encryptForRelay,
    decryptFromRelay,
    serializeEntry,
    deserializeEntry,
} from './group-cipher.js';

export {
    RelayTransport,
    type RelayTransportOptions,
} from './relay-transport.js';

export {
    SyncManager,
    type SyncManagerOptions,
    type SyncEvent,
    type SyncEventType,
    type SyncEventHandler,
} from './sync-manager.js';

export {
    P2PTransport,
    type P2PTransportOptions,
} from './p2p-transport.js';

export {
    CompositeTransport,
    type CompositeTransportOptions,
} from './composite-transport.js';
