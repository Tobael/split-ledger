# Design overview

Fair Money is an offline-first, end-to-end encrypted expense tracker. The browser remains a complete client; Tauri adds native mobile and desktop hosts for durable storage, secure secret handling, and operating-system link routing.

## Design principles

1. Signed, tamper-evident operations are immutable; corrections and voids reference earlier operations.
2. Stable participant IDs exist independently of cryptographic identities.
3. Relays are untrusted, replaceable, self-hostable, and disposable; they are rendezvous caches rather than durable group authorities.
4. All clients deterministically derive the same state from the same valid operation set.
5. Offline concurrent writes are expected and explicitly represented.
6. Protocol and UI behavior are platform-independent; storage and link delivery use adapters.
7. The web experience remains functional without installing an application.
8. Social recovery is not part of the target product.
9. Any member retaining the required history can repopulate a relay by coming online; missing-history clients explain that dependency to the user.

## Document map

| Document | Purpose |
|---|---|
| [Architecture](01-architecture.md) | Components, trust boundaries, and platform hosts |
| [Data models](02-data-models.md) | Protocol-v2 entities and operations |
| [Cryptographic flows](03-crypto-flows.md) | Keys, encryption, claims, and signing |
| [Validation](04-ledger-validation.md) | Structural, cryptographic, and authorization rules |
| [Synchronization](05-sync-protocol.md) | Convergent operation exchange |
| [Relay](06-relay-server.md) | Self-hostable ciphertext service |
| [Threat model](07-threat-model.md) | Assets, attackers, guarantees, and limits |
| [Roadmap](08-roadmap.md) | Delivery sequence |
| [Libraries](09-libraries.md) | Current technology choices |
| [Key UX](10-key-management-ux.md) | Identity and device experience |
| [Multi-device](11-multi-device-sync.md) | Device enrollment and revocation |
| [Scalability](12-scalability.md) | Limits and growth strategy |
| [Testing](13-testing-strategy.md) | Test layers and compatibility gates |
| [Re-architecture plan](14-product-rearchitecture-plan.md) | Migration handoff and status |
| [Protocol v2 specification](../protocol/v2/README.md) | Normative encoding, graph, authorization, and conflict rules |
