# 13. Testing Strategy

## Testing Pyramid

```
          ┌──────────────┐
          │   E2E Tests  │  ← 10% (critical user journeys)
          │   (Detox /   │
          │  Playwright) │
        ┌─┴──────────────┴─┐
        │ Integration Tests │  ← 30% (component interactions)
        │  (vitest + real   │
        │   storage/crypto) │
      ┌─┴──────────────────┴─┐
      │     Unit Tests        │  ← 50% (pure functions, validation)
      │     (vitest)          │
    ┌─┴──────────────────────┴─┐
    │   Property-Based Tests    │  ← 10% (invariant verification)
    │   (fast-check + vitest)   │
    └───────────────────────────┘
```

## 1. Unit Tests

### CryptoService

| Test | Description |
|------|-------------|
| `keygen produces valid keypair` | Generated keys have correct byte lengths |
| `sign + verify roundtrip` | Sign arbitrary data, verify succeeds |
| `verify rejects wrong key` | Verify with different pubkey returns false |
| `verify rejects tampered data` | Modify signed data, verify returns false |
| `hash determinism` | Same input always produces same hash |
| `canonicalize determinism` | Object key order doesn't affect output |
| `canonicalize cross-platform` | Same output as reference implementation (test vectors) |

### LedgerEngine — Validation

| Test | Description |
|------|-------------|
| `rejects missing fields` | Each required field, when omitted, produces specific error |
| `rejects hash mismatch` | Modify any field after hashing → hash integrity failure |
| `rejects bad signature` | Sign with wrong key → signature verification failure |
| `rejects broken chain` | Entry with wrong `previousHash` → continuity failure |
| `rejects unauthorized device` | Entry from unknown device key → authorization failure |
| `rejects non-member creator` | Entry from removed member's device → rejection |
| `accepts valid genesis` | Correct genesis entry passes all checks |
| `rejects duplicate genesis` | Second genesis in same group → rejection |
| `validates expense splits sum` | Splits must sum to total amount |
| `validates expense amounts positive` | Zero or negative amounts rejected |
| `validates correction references` | ExpenseCorrection must reference existing expense |
| `validates invite signature` | MemberAdded with forged invite → rejection |
| `validates invite expiry` | Expired invite → rejection |
| `validates recovery threshold` | Insufficient co-signatures → rejection |
| `validates recovery no self-sign` | Member cannot co-sign own recovery → rejection |

### BalanceComputer

| Test | Description |
|------|-------------|
| `simple 2-person split` | A pays 100, splits 50/50 → A is owed 50 |
| `multi-way unequal split` | 3-person split with different shares |
| `correction overrides original` | Corrected expense replaces original in balance |
| `removed member retains balance` | Removing member doesn't erase their debts |
| `empty group zero balances` | No expenses → all balances zero |
| `balances sum to zero` | Total of all balances always equals zero (invariant) |

### Ordering

| Test | Description |
|------|-------------|
| `lamport clock primary sort` | Lower clock comes first |
| `timestamp tiebreaker` | Same clock, earlier timestamp first |
| `pubkey tiebreaker` | Same clock + timestamp, lexicographic pubkey |
| `entry_id final tiebreaker` | All else equal, lexicographic entry_id |
| `ordering is deterministic` | Shuffle input, sort → always same output |

## 2. Integration Tests

### Ledger + Storage

| Test | Description |
|------|-------------|
| `append and retrieve` | Append entry, retrieve by ID, verify identical |
| `get entries after clock` | Append 10 entries, retrieve after clock 5, get 5 |
| `full chain roundtrip` | Create group, add members, add expenses, validate full chain from storage |
| `IndexedDB adapter parity` | Same test suite passes for both IndexedDB and SQLite adapters |
| `concurrent writes` | Two rapid appends don't corrupt storage (WAL mode) |

### Sync Protocol

| Test | Description |
|------|-------------|
| `two peers converge` | Peer A has entries 1–5, Peer B has 1–3. After sync, both have 1–5 |
| `bidirectional sync` | A has entries B doesn't; B has entries A doesn't. Both converge |
| `sync rejects invalid entry` | Peer sends tampered entry → receiving peer rejects it, keeps valid entries |
| `relay-assisted sync` | Peer offline, entry cached by relay, peer comes online and receives it |
| `new member full sync` | New member joins, receives and validates entire chain |
| `idempotent sync` | Running sync twice produces same state |

### Identity & Device Auth

| Test | Description |
|------|-------------|
| `authorize second device` | Device A authorizes Device B, B can create valid entries |
| `revoke device` | After revocation, entries from revoked device are rejected |
| `social recovery ceremony` | Simulate root key loss, collect co-signatures, rotate key, verify new key works |
| `recovery with insufficient sigs` | Below threshold → rotation rejected |

## 3. Property-Based Tests (fast-check)

| Property | Generator | Invariant |
|----------|-----------|-----------|
| `balance conservation` | Arbitrary sequence of ExpenseCreated entries | Sum of all balances == 0 |
| `ordering determinism` | Random permutation of entries | `orderEntries(shuffle(entries))` always equals `orderEntries(entries)` |
| `hash integrity` | Arbitrary entry with random field mutation | Mutated entry always fails hash check |
| `chain validity` | Arbitrary valid chain + random insertion | Invalid insertion always detected |
| `ledger replay determinism` | Same set of entries in different order | Final group state is identical |
| `correction supersedes original` | Expense + N corrections | Final balance reflects only latest correction |

```typescript
// Example: Balance conservation property
fc.assert(
  fc.property(
    fc.array(arbitraryExpenseEntry(), { minLength: 1, maxLength: 100 }),
    (expenses) => {
      const balances = computeBalances(expenses);
      const total = Array.from(balances.values()).reduce((a, b) => a + b, 0);
      return total === 0;
    }
  )
);
```

## 4. End-to-End Tests

### Critical User Journeys

| Journey | Steps | Platforms |
|---------|-------|-----------|
| **Onboarding** | Launch → enter name → identity created → home screen | iOS, Android, Web |
| **Create group** | Tap create → enter name → group visible with self as member | All |
| **Invite & join** | Member A creates invite → B opens link → B joins → both see each other | iOS ↔ Web |
| **Add expense** | Enter amount → select payer → split → confirm → appears in group for all members | All |
| **Balance check** | After expenses → balances screen shows correct amounts → matches manual calculation | All |
| **Correct expense** | Select existing expense → correct → new balance reflects correction | All |
| **Device auth** | Device A shows QR → Device B scans → B linked → B creates expense → A sees it | iOS ↔ iPad |
| **Device revocation** | Revoke Device B → B's new entries rejected by peers | All |
| **Social recovery** | Simulate lost device → request recovery → 2/3 approve → new device operational | All |
| **Offline relay catch-up** | Device goes offline → peer creates expense → device reconnects → receives entry | All |

### Multi-Peer Simulation

```typescript
// Test harness: simulate N peers with independent storage
class SimulatedPeer {
  identity: DeviceIdentity;
  storage: InMemoryStorageAdapter;
  ledger: LedgerEngine;
  sync: SyncManager;
}

function createTestNetwork(peerCount: number): SimulatedPeer[] { ... }

// Scenario: 5 peers, each creates 10 expenses concurrently
// After sync: all peers have identical ordered ledger and identical balances
test('5-peer concurrent expense creation', async () => {
  const peers = createTestNetwork(5);
  // Each peer creates expenses in parallel
  await Promise.all(peers.map(p => createRandomExpenses(p, 10)));
  // Sync all peers pairwise
  await syncAllPeers(peers);
  // Verify convergence
  const states = peers.map(p => p.ledger.getGroupState());
  for (let i = 1; i < states.length; i++) {
    expect(states[i]).toDeepEqual(states[0]);
  }
});
```

## 5. Relay Server Tests

| Test | Description |
|------|-------------|
| `publish and subscribe` | Client publishes entry, subscriber receives it |
| `catch-up after disconnect` | Client disconnects, entries arrive, client reconnects and receives them |
| `rate limiting` | Exceeding rate limit returns appropriate error |
| `invite CRUD` | Create, read, delete invite links |
| `expired invite cleanup` | Expired invites are pruned by scheduled job |
| `auth rejection` | Invalid auth token → connection rejected |
| `max connections` | Per-IP connection limit enforced |

## CI Pipeline

```yaml
name: CI
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - run: npm run test:property

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgres:16 }
      redis: { image: redis:7 }
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:integration

  e2e-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright install
      - run: npm run test:e2e:web

  e2e-native:
    runs-on: macos-latest  # for iOS simulator
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:e2e:ios
```

## Coverage Targets

| Layer | Target | Rationale |
|-------|--------|-----------|
| CryptoService | 100% | Security-critical; no untested paths |
| LedgerEngine (validation) | 100% | Security-critical |
| BalanceComputer | 100% | Financial correctness |
| SyncManager | 90% | Complex async code; edge cases hard to cover |
| StorageAdapter | 95% | Data integrity; test both implementations |
| UI Components | 70% | Snapshot tests + critical interaction tests |
| Relay Server | 90% | API contract coverage |
