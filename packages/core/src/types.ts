// =============================================================================
// SplitLedger — Core Type Definitions
// =============================================================================

// --- Branded Primitive Types ------------------------------------------------

/** 32-byte Ed25519 public key, hex-encoded */
export type PublicKey = string & { readonly __brand: 'PublicKey' };

/** 64-byte Ed25519 secret key, hex-encoded (never leaves device) */
export type SecretKey = string & { readonly __brand: 'SecretKey' };

/** 64-byte Ed25519 signature, hex-encoded */
export type Signature = string & { readonly __brand: 'Signature' };

/** SHA-256 hash, hex-encoded */
export type Hash = string & { readonly __brand: 'Hash' };

/** UUID v4 */
export type GroupId = string & { readonly __brand: 'GroupId' };

// --- Crypto Helpers ---------------------------------------------------------

export interface Ed25519KeyPair {
    publicKey: PublicKey;
    secretKey: SecretKey;
}

// --- Identity ---------------------------------------------------------------

export interface RootIdentity {
    rootKeyPair: Ed25519KeyPair;
    displayName: string;
    createdAt: number; // Unix ms
}

export interface DeviceKeyAuthorization {
    devicePublicKey: PublicKey;
    rootPublicKey: PublicKey;
    deviceName: string;
    authorizedAt: number;
    /** Signature of { devicePublicKey, rootPublicKey, authorizedAt } by root secret key */
    authorizationSignature: Signature;
}

export interface DeviceIdentity {
    deviceKeyPair: Ed25519KeyPair;
    rootPublicKey: PublicKey;
    deviceName: string;
    authorization: DeviceKeyAuthorization;
}

// --- Ledger Entry -----------------------------------------------------------

export enum EntryType {
    Genesis = 'Genesis',
    ExpenseCreated = 'ExpenseCreated',
    ExpenseCorrection = 'ExpenseCorrection',
    MemberAdded = 'MemberAdded',
    MemberRemoved = 'MemberRemoved',
    DeviceAuthorized = 'DeviceAuthorized',
    DeviceRevoked = 'DeviceRevoked',
    RootKeyRotation = 'RootKeyRotation',
}

export interface LedgerEntryBase {
    /** SHA-256 hash of the canonical serialization of all fields except entryId and signature */
    entryId: Hash;
    /** Hash of the immediately preceding entry (null only for Genesis) */
    previousHash: Hash | null;
    /** Monotonically increasing logical clock */
    lamportClock: number;
    /** Unix millisecond timestamp (wallclock, advisory only) */
    timestamp: number;
    entryType: EntryType;
    /** Public key of the device that created this entry */
    creatorDevicePubkey: PublicKey;
    /** Ed25519 signature over the entryId by creator device key */
    signature: Signature;
}

// --- Payloads ---------------------------------------------------------------

export interface GenesisPayload {
    groupId: GroupId;
    groupName: string;
    creatorRootPubkey: PublicKey;
    creatorDisplayName: string;
}

export interface ExpenseCreatedPayload {
    description: string;
    /** Amount in smallest currency unit (e.g., cents) to avoid floating point */
    amountMinorUnits: number;
    currency: string; // ISO 4217
    paidByRootPubkey: PublicKey;
    /** Map of root public key → share in minor units (must sum to amountMinorUnits) */
    splits: Record<string, number>;
    category?: string;
    receiptHash?: Hash;
}

export interface ExpenseCorrectionPayload {
    /** entry_id of the original ExpenseCreated (or prior correction) */
    referencedEntryId: Hash;
    correctionReason: string;
    /** Full replacement expense data */
    correctedExpense: ExpenseCreatedPayload;
}

export interface MemberAddedPayload {
    memberRootPubkey: PublicKey;
    memberDisplayName: string;
    /** Signed invite token that authorized this join */
    inviteToken: InviteToken;
}

export interface MemberRemovedPayload {
    memberRootPubkey: PublicKey;
    reason: string;
}

export interface DeviceAuthorizedPayload {
    ownerRootPubkey: PublicKey;
    devicePublicKey: PublicKey;
    deviceName: string;
    /** Root key's signature over { devicePublicKey, ownerRootPubkey, timestamp } */
    authorizationSignature: Signature;
}

export interface DeviceRevokedPayload {
    ownerRootPubkey: PublicKey;
    devicePublicKey: PublicKey;
    reason: string;
}

export interface RootKeyRotationPayload {
    previousRootPubkey: PublicKey;
    newRootPubkey: PublicKey;
    /** Signatures from majority of active group members' root keys */
    coSignatures: CoSignature[];
}

export interface CoSignature {
    signerRootPubkey: PublicKey;
    /** Signs { previousRootPubkey, newRootPubkey, groupId } */
    signature: Signature;
}

// --- Entry Payload Map (for discriminated union) ----------------------------

export type PayloadMap = {
    [EntryType.Genesis]: GenesisPayload;
    [EntryType.ExpenseCreated]: ExpenseCreatedPayload;
    [EntryType.ExpenseCorrection]: ExpenseCorrectionPayload;
    [EntryType.MemberAdded]: MemberAddedPayload;
    [EntryType.MemberRemoved]: MemberRemovedPayload;
    [EntryType.DeviceAuthorized]: DeviceAuthorizedPayload;
    [EntryType.DeviceRevoked]: DeviceRevokedPayload;
    [EntryType.RootKeyRotation]: RootKeyRotationPayload;
};

// --- Discriminated Union for LedgerEntry ------------------------------------

export type LedgerEntry = {
    [K in EntryType]: LedgerEntryBase & { entryType: K; payload: PayloadMap[K] };
}[EntryType];

// --- Invite Token -----------------------------------------------------------

export interface InviteToken {
    groupId: GroupId;
    inviterRootPubkey: PublicKey;
    expiresAt: number; // Unix ms
    /** Signature of { groupId, inviterRootPubkey, expiresAt } by inviter's root key */
    inviteSignature: Signature;
}

/** Serialized as URL-safe base64 for deep-link sharing */
export type InviteLink = string & { readonly __brand: 'InviteLink' };

// --- Derived Group State ----------------------------------------------------

export interface GroupMember {
    rootPubkey: PublicKey;
    displayName: string;
    joinedAt: number;
    isActive: boolean;
    removedAt?: number;
    authorizedDevices: Set<PublicKey>;
}

export interface GroupState {
    groupId: GroupId;
    groupName: string;
    creatorRootPubkey: PublicKey;
    members: Map<PublicKey, GroupMember>;
    latestEntryHash: Hash;
    currentLamportClock: number;
    /** Net balances: positive = owed money, negative = owes money */
    balances: Map<PublicKey, number>;
}

// --- Validation Result ------------------------------------------------------

export interface ValidationError {
    field?: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

export interface ChainValidationResult extends ValidationResult {
    finalState: GroupState | null;
}

// --- Storage Adapter --------------------------------------------------------

export interface StorageAdapter {
    // Ledger operations
    appendEntry(groupId: GroupId, entry: LedgerEntry): Promise<void>;
    getEntry(entryId: Hash): Promise<LedgerEntry | null>;
    getEntriesAfter(groupId: GroupId, afterLamportClock: number): Promise<LedgerEntry[]>;
    getLatestEntry(groupId: GroupId): Promise<LedgerEntry | null>;
    getAllEntries(groupId: GroupId): Promise<LedgerEntry[]>;

    // Identity operations
    storeRootIdentity(identity: RootIdentity): Promise<void>;
    getRootIdentity(): Promise<RootIdentity | null>;
    storeDeviceIdentity(identity: DeviceIdentity): Promise<void>;
    getDeviceIdentity(): Promise<DeviceIdentity | null>;

    // Group metadata
    getGroupIds(): Promise<GroupId[]>;
    getGroupState(groupId: GroupId): Promise<GroupState | null>;
    saveGroupState(state: GroupState): Promise<void>;
}

// --- Entry Building (pre-hash, pre-sign) ------------------------------------

export interface UnsignedEntryFields {
    previousHash: Hash | null;
    lamportClock: number;
    timestamp: number;
    entryType: EntryType;
    payload: PayloadMap[EntryType];
    creatorDevicePubkey: PublicKey;
}
