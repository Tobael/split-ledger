# SplitLedger — Decentralized Group Expense Tracking System

> Production-ready system design document

## Table of Contents

| # | Document | Description |
|---|----------|-------------|
| 1 | [Architecture](01-architecture.md) | Full architecture diagram, component breakdown |
| 2 | [Data Models](02-data-models.md) | TypeScript interfaces for all domain types |
| 3 | [Cryptographic Flows](03-crypto-flows.md) | Identity, device auth, invites, expenses, recovery |
| 4 | [Ledger Validation](04-ledger-validation.md) | Validation pseudocode for all entry types |
| 5 | [Sync Protocol](05-sync-protocol.md) | Peer sync and relay exchange protocol |
| 6 | [Relay Server](06-relay-server.md) | Minimal relay server specification |
| 7 | [Threat Model](07-threat-model.md) | Accidental tampering + compromised relay analysis |
| 8 | [Implementation Roadmap](08-roadmap.md) | MVP → production phased plan |
| 9 | [Libraries](09-libraries.md) | Recommended libraries with rationale |
| 10 | [Key Management UX](10-key-management-ux.md) | Key lifecycle UX design |
| 11 | [Multi-Device Sync](11-multi-device-sync.md) | Multi-device synchronization design |
| 12 | [Scalability](12-scalability.md) | Scalability analysis and mitigations |
| 13 | [Testing Strategy](13-testing-strategy.md) | Comprehensive testing plan |

## Design Principles

1. **Immutability** — Ledger entries are never deleted or mutated; corrections reference originals.
2. **Cryptographic integrity** — Every entry is hash-linked, signed, and locally validated.
3. **Decentralization** — No single authority; the ledger is the source of truth.
4. **Determinism** — Balances are computed identically by every participant via ordered replay.
5. **Privacy** — The relay server stores only encrypted blobs; it cannot read or forge entries.
6. **Recoverability** — Social recovery via group co-signing prevents permanent lockout.
7. **Cross-platform** — Single TypeScript codebase targets web, iOS, and Android via Expo.
