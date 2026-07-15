// =============================================================================
// SplitLedger — Core Public API
// =============================================================================

// Types
export type {
    ChainValidationResult,
    DeviceAuthorizedPayload,
    DeviceIdentity,
    DeviceKeyAuthorization,
    DeviceRevokedPayload,
    Ed25519KeyPair,
    ExpenseCorrectionPayload,
    ExpenseCreatedPayload,
    GenesisPayload,
    GroupId,
    GroupMember,
    GroupState,
    Hash,
    InviteLink,
    InviteToken,
    LedgerEntry,
    LedgerEntryBase,
    MemberAddedPayload,
    MemberRemovedPayload,
    MemberRenamedPayload,
    PayloadMap,
    PublicKey,
    RootIdentity,
    SecretKey,
    Signature,
    StorageAdapter,
    UnsignedEntryFields,
    ValidationError,
    ValidationResult,
} from './types.js';

export { EntryType } from './types.js';

// Crypto
export {
    canonicalize,
    computeEntryId,
    generateKeyPair,
    generateRandomBytes,
    hash,
    sign,
    signEntryId,
    verify,
    verifyEntrySignature,
} from './crypto.js';

// Identity
export {
    createDeviceAuthorization,
    createDeviceIdentity,
    createInviteToken,
    createRootRotationAuthorization,
    createRootIdentity,
    generateGroupId,
    verifyDeviceAuthorization,
    verifyInviteSignature,
    verifyRootRotationAuthorization,
} from './identity.js';

// Ledger
export {
    applyEntry,
    buildEntry,
    createEmptyGroupState,
    orderEntries,
    validateEntry,
    validateFullChain,
} from './ledger.js';

// Balance
export {
    computeBalances,
    computeSettlements,
    getEffectiveExpenses,
    recomputeGroupBalances,
} from './balance.js';

// Storage
export { InMemoryStorageAdapter } from './storage.js';

// Schemas
export {
    parseLedgerEntry,
    validateEntryStructure,
    genesisPayloadSchema,
    expenseCreatedPayloadSchema,
    expenseCorrectionPayloadSchema,
    memberAddedPayloadSchema,
    memberRemovedPayloadSchema,
    deviceAuthorizedPayloadSchema,
    deviceRevokedPayloadSchema,
    selfRootKeyRotationPayloadSchema,
    ledgerEntryBaseSchema,
} from './schemas.js';

// Sync
export {
    deriveGroupKey,
    encryptForRelay,
    decryptFromRelay,
    serializeEntry,
    deserializeEntry,
    RelayTransport,
    SyncManager,
} from './sync/index.js';

export type {
    Transport,
    TransportEntry,
    OnEntryHandler,
    OnConnectionStateHandler,
    RelayTransportOptions,
    SyncManagerOptions,
    SyncEvent,
    SyncEventType,
    SyncEventHandler,
} from './sync/index.js';

// Group Manager
export {
    GroupManager,
} from './group-manager.js';

export type {
    GroupManagerOptions,
    CreateGroupResult,
    JoinGroupResult,
} from './group-manager.js';

// Invite Links
export {
    serializeInviteLink,
    parseInviteLink,
} from './invite-link.js';

export type {
    InviteLinkData,
} from './invite-link.js';

// Protocol v2
export * from './protocol-v2/index.js';
