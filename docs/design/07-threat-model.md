# 7. Threat Model

## Scope

This analysis covers two primary threat categories:

1. **Accidental tampering** — data corruption, software bugs, clock drift
2. **Compromised relay server** — adversary controls the relay infrastructure

Out of scope: nation-state level attacks, side-channel attacks on device hardware, physical device theft (though mitigated by platform secure storage).

---

## Threat 1: Accidental Data Corruption

| Threat | Attack / Failure | Mitigation | Detection |
|--------|-----------------|------------|-----------|
| T1.1 Bit-flip in storage | Storage hardware error corrupts an entry | Hash integrity check on every read; re-validate chain on app startup | `validateEntry()` returns hash mismatch |
| T1.2 Partial write | App crashes mid-write, entry partially persisted | Atomic transactions in SQLite/IndexedDB; write-ahead logging | Incomplete entry fails structural validation |
| T1.3 Clock skew | Device clock is wildly wrong, producing bad timestamps | Timestamps are advisory; ordering uses Lamport clock primarily; ±5 min skew tolerance on invite expiry | Anomalous timestamps flagged in UI (not rejected) |
| T1.4 Duplicate entry | Same entry appended twice due to retry logic | Entries keyed by `entryId` (content hash) — natural deduplication | Storage adapter rejects duplicate primary key |
| T1.5 Wrong Lamport clock | Bug assigns non-monotonic clock | Validation rejects entries with clock ≤ current tip for local appends | `validateEntry()` catches monotonicity violation |
| T1.6 Stale state replay | Old cached entry re-processed | `previousHash` chain prevents re-insertion at wrong position | Chain validation fails |

## Threat 2: Compromised Relay Server

| Threat | Attack | Mitigation | Detection |
|--------|--------|------------|-----------|
| T2.1 Read stored entries | Relay operator reads encrypted blobs | Entries encrypted with group-scoped symmetric key; relay never has key | N/A — entries are ciphertext to relay |
| T2.2 Drop entries | Relay silently drops entries for specific groups | Clients sync directly via P2P (WebRTC) as primary channel; relay is fallback only | Peers detect missing entries during P2P sync |
| T2.3 Replay old entries | Relay re-sends already-processed entries | Entries deduplicated by `entryId`; Lamport clock prevents re-ordering | Duplicate detection in `appendEntry()` |
| T2.4 Inject forged entries | Relay creates fake expense entries | Every entry requires valid Ed25519 signature from authorized device key; relay has no device keys | `validateEntry()` rejects invalid signatures |
| T2.5 Reorder entries | Relay delivers entries out of order | Deterministic ordering by Lamport clock + tiebreakers; independent of delivery order | Honest clients converge to same order regardless of relay behavior |
| T2.6 Withhold entries selectively | Relay delivers entries to some users but not others (eclipse attack) | P2P direct connections detect differences; background sync catches gaps | Periodic P2P reconciliation detects divergence |
| T2.7 Serve corrupt full ledger to new member | New member gets poisoned chain from relay | Full chain validation from Genesis before accepting; can verify with any existing peer via P2P | `validateFullChain()` rejects invalid chains |
| T2.8 Forge invite links | Relay creates fake invite links | Invites are Ed25519-signed by inviter's root key; relay cannot forge signatures | `verifyMemberAddedEntry()` rejects forged invites |
| T2.9 DDoS / availability | Relay taken offline | P2P connections continue to function; relay is a convenience, not a requirement | Automatic fallback; users see "relay unavailable" indicator |

## Threat 3: Compromised Peer

| Threat | Attack | Mitigation | Detection |
|--------|--------|------------|-----------|
| T3.1 Send invalid entries | Malicious peer pushes garbage | Full validation on every received entry | `validateEntry()` rejects; peer flagged |
| T3.2 Withhold entries | Peer refuses to share entries | Other peers and relay provide redundancy | Background sync with multiple sources |
| T3.3 Spam valid entries | Peer creates thousands of valid expense entries | Rate limiting at application layer (max entries per hour per member); UI warnings for anomalous activity | Entry rate monitoring |
| T3.4 Compromised device key | Attacker steals device secret key | Device revocation via `DeviceRevoked` entry from root key; root key stored separately in hardware enclave | Owner notices unauthorized entries, revokes device |
| T3.5 Compromised root key | Attacker steals root secret key | Social recovery: majority of group co-signs `RootKeyRotation` to replace root key | User triggers recovery ceremony |

## Security Properties Summary

| Property | Guarantee | Mechanism |
|----------|-----------|-----------|
| **Integrity** | No entry can be modified after creation | SHA-256 hash chain + Ed25519 signatures |
| **Authenticity** | Every entry provably from authorized device | Ed25519 device signatures verified against root-authorized device list |
| **Non-repudiation** | Authors cannot deny creating an entry | Signatures are unforgeable without secret key |
| **Ordering consistency** | All honest peers derive same order | Deterministic ordering by Lamport clock + tiebreakers |
| **Membership control** | Only invited members can join | Invite tokens signed by existing members |
| **Recoverability** | Lost root key can be replaced | Social recovery via majority co-signing |
| **Relay independence** | System functions without relay | P2P as primary transport; relay is optimization only |

## Residual Risks

1. **Key compromise without detection** — If an attacker obtains a device key and uses it subtly (small fraudulent expenses), detection depends on user vigilance. Mitigation: periodic activity summaries, push notifications for all new entries.

2. **Sybil attack on social recovery** — If an attacker controls majority of group members (e.g., creating fake members), they can rotate anyone's root key. Mitigation: `MemberAdded` requires signed invites from existing members; review membership carefully.

3. **Metadata leakage at relay** — Even with encrypted entries, the relay sees group IDs, connection patterns, entry sizes, and timing. Mitigation: consider Tor-based relay connections for high-sensitivity groups (out of scope for MVP).

4. **Group key distribution** — The symmetric group encryption key for relay storage must be securely distributed to new members. If leaked, past relay-cached entries become readable (but not forgeable). Mitigation: rotate group encryption key periodically.
