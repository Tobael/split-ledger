# Protocol-v2 data models

These are the target models replacing the pre-release v1 implementation. No v1 compatibility layer or data migration is required.

Protocol-v2 persistence stores only validated signed operations. `GroupServiceV2` validates a complete local/remote operation union before persistence and derives `GroupStateV2` on demand; projected group state is not an authoritative stored record.

```ts
type GroupId = string;
type OperationId = string;
type ParticipantId = string;
type CapabilityId = string;
type PublicKey = string;
type Signature = string;

interface SignedOperation<T extends OperationPayload> {
  protocolVersion: 2;
  operationId: OperationId;
  groupId: GroupId;
  parents: OperationId[];
  lamportClock: number;
  createdAt: number;
  actorPublicKey: PublicKey;
  payload: T;
  signature: Signature;
}
```

`operationId` is the hash of canonical unsigned content. `parents` describe the known frontier and allow concurrent branches.

## Participants

```ts
interface ParticipantSlot {
  participantId: ParticipantId;
  displayName: string;
  status: 'unclaimed' | 'claimed' | 'disabled';
  claimedRootPublicKey?: PublicKey;
  createdBy: ParticipantId;
}
```

Balances and expenses reference `ParticipantId`, never identity keys.

## Claim capabilities

```ts
interface ClaimCapability {
  capabilityId: CapabilityId;
  participantId: ParticipantId;
  displayExpiresAt?: number;
  secretCommitment: string;
  status: 'active' | 'consumed' | 'revoked';
}
```

The link contains the secret; group history contains only its commitment. A successful claim binds a newly generated root public key to the slot and consumes the capability. `displayExpiresAt` is advisory UI and relay-retention metadata, not a ledger authorization input; deterministic invalidation uses a signed revocation.

## Expenses

```ts
interface ExpenseData {
  description: string;
  amountMinorUnits: number;
  currency: string;
  paidBy: ParticipantId;
  splits: Record<ParticipantId, number>;
  category?: string;
}
```

Amounts are positive safe integers in minor units. Splits are non-negative and sum exactly to the amount.

## Operations

| Operation | Purpose |
|---|---|
| `GroupCreated` | Establish group metadata and creator slot |
| `ParticipantSlotCreated` | Add an unclaimed participant |
| `ParticipantSlotRenamed` | Change participant display name |
| `ClaimCapabilityIssued` | Authorize one targeted claim or one choice among any unclaimed slot |
| `ClaimCapabilityRevoked` | Invalidate an unused capability |
| `ParticipantSlotClaimed` | Bind a key and consume a capability |
| `ParticipantSlotReset` | Auditable administrative reassignment |
| `ParticipantSlotDisabled` | Remove future participation without rewriting history |
| `ExpenseCreated` | Add an expense |
| `ExpenseCorrected` | Replace effective expense data |
| `ExpenseVoided` | Tombstone an expense |
| `SettlementCreated` | Record a settlement transfer |
| `DeviceAuthorized` | Add a device key for an identity |
| `DeviceRevoked` | Revoke a device key |

## Derived state

Group state is a projection and is never synchronized as authority. Cached projections may be discarded and rebuilt from validated operations.

The TypeScript v2 implementation exposes a complete derived state containing group metadata, participant slots, claim capabilities, devices, effective expenses, settlements, per-currency balances, and the current DAG frontier. Resetting a slot invalidates capabilities issued before that reset; revoked device keys cannot be enrolled again.
