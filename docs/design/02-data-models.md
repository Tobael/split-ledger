# 2. TypeScript Data Models

## Core Cryptographic Types

```typescript
/** 32-byte Ed25519 public key, hex-encoded */
type PublicKey = string & { readonly __brand: 'PublicKey' };

/** 64-byte Ed25519 secret key, hex-encoded (never leaves device) */
type SecretKey = string & { readonly __brand: 'SecretKey' };

/** 64-byte Ed25519 signature, hex-encoded */
type Signature = string & { readonly __brand: 'Signature' };

/** SHA-256 hash, hex-encoded */
type Hash = string & { readonly __brand: 'Hash' };

/** UUID v4 */
type GroupId = string & { readonly __brand: 'GroupId' };

interface Ed25519KeyPair {
  publicKey: PublicKey;
  secretKey: SecretKey;
}
```

## Identity Types

```typescript
interface RootIdentity {
  rootKeyPair: Ed25519KeyPair;
  displayName: string;
  createdAt: number; // Unix ms
}

interface DeviceKeyAuthorization {
  devicePublicKey: PublicKey;
  rootPublicKey: PublicKey;
  deviceName: string;
  authorizedAt: number;
  /** Signature of (devicePublicKey ‖ rootPublicKey ‖ authorizedAt) by root secret key */
  authorizationSignature: Signature;
}

interface DeviceIdentity {
  deviceKeyPair: Ed25519KeyPair;
  rootPublicKey: PublicKey;
  deviceName: string;
  authorization: DeviceKeyAuthorization;
}
```

## Ledger Entry Types

```typescript
enum EntryType {
  Genesis              = 'Genesis',
  ExpenseCreated       = 'ExpenseCreated',
  ExpenseCorrection    = 'ExpenseCorrection',
  MemberAdded          = 'MemberAdded',
  MemberRemoved        = 'MemberRemoved',
  DeviceAuthorized     = 'DeviceAuthorized',
  DeviceRevoked        = 'DeviceRevoked',
  RootKeyRotation      = 'RootKeyRotation',
}

interface LedgerEntryBase {
  /** SHA-256 hash of the canonical serialization of all fields except entry_id and signature */
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

  /** Ed25519 signature over the entry_id by creator device key */
  signature: Signature;
}

// --- Payloads ---

interface GenesisPayload {
  groupId: GroupId;
  groupName: string;
  creatorRootPubkey: PublicKey;
  creatorDisplayName: string;
}

interface ExpenseCreatedPayload {
  description: string;
  /** Amount in smallest currency unit (e.g., cents) to avoid floating point */
  amountMinorUnits: number;
  currency: string; // ISO 4217
  paidByRootPubkey: PublicKey;
  /** Map of root public key → share in minor units (must sum to amountMinorUnits) */
  splits: Record<PublicKey, number>;
  category?: string;
  receiptHash?: Hash; // optional SHA-256 of receipt image
}

interface ExpenseCorrectionPayload {
  /** entry_id of the original ExpenseCreated (or prior ExpenseCorrection) being corrected */
  referencedEntryId: Hash;
  correctionReason: string;
  /** Full replacement expense data */
  correctedExpense: ExpenseCreatedPayload;
}

interface MemberAddedPayload {
  memberRootPubkey: PublicKey;
  memberDisplayName: string;
  /** Signed invite token that authorized this join */
  inviteToken: InviteToken;
}

interface MemberRemovedPayload {
  memberRootPubkey: PublicKey;
  reason: string;
}

interface DeviceAuthorizedPayload {
  ownerRootPubkey: PublicKey;
  devicePublicKey: PublicKey;
  deviceName: string;
  /** Root key's signature over (devicePublicKey ‖ ownerRootPubkey ‖ timestamp) */
  authorizationSignature: Signature;
}

interface DeviceRevokedPayload {
  ownerRootPubkey: PublicKey;
  devicePublicKey: PublicKey;
  reason: string;
}

interface RootKeyRotationPayload {
  previousRootPubkey: PublicKey;
  newRootPubkey: PublicKey;
  /** Required: signatures from majority of active group members' root keys */
  coSignatures: Array<{
    signerRootPubkey: PublicKey;
    signature: Signature; // signs (previousRootPubkey ‖ newRootPubkey ‖ groupId)
  }>;
}

// --- Typed Entry Union ---

type LedgerEntry =
  | (LedgerEntryBase & { entryType: EntryType.Genesis;            payload: GenesisPayload })
  | (LedgerEntryBase & { entryType: EntryType.ExpenseCreated;     payload: ExpenseCreatedPayload })
  | (LedgerEntryBase & { entryType: EntryType.ExpenseCorrection;  payload: ExpenseCorrectionPayload })
  | (LedgerEntryBase & { entryType: EntryType.MemberAdded;        payload: MemberAddedPayload })
  | (LedgerEntryBase & { entryType: EntryType.MemberRemoved;      payload: MemberRemovedPayload })
  | (LedgerEntryBase & { entryType: EntryType.DeviceAuthorized;   payload: DeviceAuthorizedPayload })
  | (LedgerEntryBase & { entryType: EntryType.DeviceRevoked;      payload: DeviceRevokedPayload })
  | (LedgerEntryBase & { entryType: EntryType.RootKeyRotation;    payload: RootKeyRotationPayload });
```

## Invite Token

```typescript
interface InviteToken {
  groupId: GroupId;
  inviterRootPubkey: PublicKey;
  expiresAt: number; // Unix ms
  /** Signature of (groupId ‖ inviterRootPubkey ‖ expiresAt) by inviter's root key */
  inviteSignature: Signature;
}

/** Serialized as URL-safe base64 for deep-link sharing */
type InviteLink = string & { readonly __brand: 'InviteLink' };
```

## Group State (Derived)

```typescript
interface GroupMember {
  rootPubkey: PublicKey;
  displayName: string;
  joinedAt: number;
  isActive: boolean;
  removedAt?: number;
  authorizedDevices: Set<PublicKey>;
}

interface GroupState {
  groupId: GroupId;
  groupName: string;
  members: Map<PublicKey, GroupMember>;
  latestEntryHash: Hash;
  currentLamportClock: number;
  /** Net balances per member: positive = owed money, negative = owes money */
  balances: Map<PublicKey, number>;
}
```

## Storage Adapter Interface

```typescript
interface StorageAdapter {
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
```
