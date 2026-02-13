# 8. Implementation Roadmap

## Phase 0 — Foundation (Weeks 1–3)

**Goal**: Project scaffolding, core crypto, and data layer.

| Task | Details | Deliverable |
|------|---------|-------------|
| Expo + monorepo setup | `npx create-expo-app`, TypeScript strict mode, ESLint, Prettier | Working empty app on all 3 platforms |
| Crypto service | Ed25519 keygen, sign, verify; SHA-256 hashing; canonical serialization | `CryptoService` with 100% unit test coverage |
| Data model types | All TypeScript interfaces from §2 | `types/` package |
| Storage adapter interface | Abstract interface + IndexedDB implementation | `StorageAdapter` with integration tests |
| SQLite adapter | expo-sqlite implementation of same interface | Parity tests against IndexedDB adapter |

## Phase 1 — Local Ledger Engine (Weeks 4–6)

**Goal**: Fully functional local ledger with no networking.

| Task | Details | Deliverable |
|------|---------|-------------|
| Identity creation flow | Root key + device key generation, secure storage | Identity manager |
| Ledger engine | Append, validate (all rules from §4), ordering | `LedgerEngine` |
| Balance computer | Deterministic replay, expense aggregation | `BalanceComputer` |
| Genesis + expense entries | Create group, add expenses, view balances — all local | End-to-end local test |
| Unit + property tests | Validation edge cases, ordering determinism, balance correctness | CI passing |

## Phase 2 — Networking & Sync (Weeks 7–10)

**Goal**: Multi-device and multi-peer sync.

| Task | Details | Deliverable |
|------|---------|-------------|
| Relay server (v1) | WebSocket server, PostgreSQL backend, encrypted entry cache | Deployed relay |
| Relay transport client | WebSocket connection, pub/sub, entry exchange | `RelayTransport` |
| Sync manager | Handshake, gap detection, entry exchange protocol from §5 | `SyncManager` |
| libp2p integration | WebRTC transport, peer discovery via relay signaling | `P2PTransport` |
| Multi-device sync | Device authorization flow, cross-device entry propagation | Two devices in sync |

## Phase 3 — Group Membership (Weeks 11–13)

**Goal**: Invite links, member management, permissions.

| Task | Details | Deliverable |
|------|---------|-------------|
| Invite creation & deep links | Generate signed invites, URL scheme handling | Share invite link |
| Join flow | Parse invite, sync ledger, create MemberAdded entry | New member joins group |
| Member removal | MemberRemoved entry, permission checks | Remove member flow |
| Device revocation | DeviceRevoked entry, re-validation of subsequent entries | Revoke device from settings |

## Phase 4 — Social Recovery (Weeks 14–15)

**Goal**: Root key recovery ceremony.

| Task | Details | Deliverable |
|------|---------|-------------|
| Recovery request UI | Initiate recovery, generate new root key | Recovery request screen |
| Co-signing flow | Group members receive request, sign, return co-signatures | Co-signing flow |
| RootKeyRotation entry | Collect threshold signatures, publish rotation entry | New root key active |
| Edge case handling | Insufficient co-signers, timeout, retry | Robust recovery |

## Phase 5 — UI/UX Polish (Weeks 16–19)

**Goal**: Production-quality user experience.

| Task | Details | Deliverable |
|------|---------|-------------|
| Group dashboard | Member list, recent expenses, balance summary | Main screen |
| Expense entry UX | Camera receipt, split calculator, category picker | Add expense flow |
| Balance settlement | Suggest optimal transfers, mark as settled | Settlement flow |
| Settings & devices | Device list, authorized devices, revocation | Settings screens |
| Notifications | Push notifications for new expenses, sync status | Real-time updates |
| Onboarding | First-run identity creation, tutorial | Guided onboarding |

## Phase 6 — Hardening & Launch (Weeks 20–24)

**Goal**: Production readiness.

| Task | Details | Deliverable |
|------|---------|-------------|
| Security audit | Crypto review, penetration testing | Audit report |
| Performance profiling | Large group (50+ members, 10K+ entries) testing | Performance benchmarks |
| E2E test suite | Automated multi-device, multi-peer test scenarios | CI pipeline |
| App store preparation | Icons, screenshots, store listings | App store submissions |
| Relay server hardening | Rate limiting, monitoring, alerting, backup | Production relay |
| Documentation | User guide, developer docs, API documentation | Published docs |

## Milestone Summary

```
Week  0 ───────── 3 ───────── 6 ──────── 10 ──────── 13 ──── 15 ──────── 19 ──────── 24
      │           │           │           │           │       │           │           │
      ▼           ▼           ▼           ▼           ▼       ▼           ▼           ▼
   Foundation  Local       Networking  Membership  Recovery  UI/UX     Hardening  LAUNCH
               Ledger      & Sync                            Polish    & Launch
```
