# 1. Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT APPLICATION                                 │
│                    (React Native + Expo — Web / iOS / Android)              │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         UI LAYER (React Native)                       │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────┐  │  │
│  │  │  Groups   │ │ Expenses │ │  Balances  │ │ Members  │ │ Settings │  │  │
│  │  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └────┬─────┘ └────┬─────┘  │  │
│  └───────┼──────────── ┼────────────┼────────────┼────────────┼─────────┘  │
│          │             │            │            │            │             │
│  ┌───────▼─────────────▼────────────▼────────────▼────────────▼─────────┐  │
│  │                     BUSINESS LOGIC LAYER                              │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │  │
│  │  │ LedgerEngine │ │   Identity   │ │   Balance    │                  │  │
│  │  │  - append    │ │   Manager    │ │   Computer   │                  │  │
│  │  │  - validate  │ │  - keys      │ │  - replay    │                  │  │
│  │  │  - order     │ │  - devices   │ │  - settle    │                  │  │
│  │  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘                  │  │
│  │         │                │                 │                          │  │
│  │  ┌──────▼────────────────▼─────────────────▼──────┐                  │  │
│  │  │              CryptoService                      │                  │  │
│  │  │  - Ed25519 sign / verify                        │                  │  │
│  │  │  - SHA-256 hashing                              │                  │  │
│  │  │  - X25519 key exchange (relay encryption)       │                  │  │
│  │  └────────────────────────────────────────────────┘                  │  │
│  └──────────────────────────┬────────────────────────────────────────────┘  │
│                             │                                               │
│  ┌──────────────────────────▼────────────────────────────────────────────┐  │
│  │                      NETWORKING LAYER                                 │  │
│  │  ┌──────────────────┐          ┌──────────────────┐                  │  │
│  │  │  P2P Transport   │          │  Relay Transport │                  │  │
│  │  │  (libp2p/WebRTC) │◄────────►│  (WebSocket)     │                  │  │
│  │  └────────┬─────────┘          └────────┬─────────┘                  │  │
│  │           │                              │                            │  │
│  │  ┌────────▼──────────────────────────────▼─────┐                     │  │
│  │  │              SyncManager                     │                     │  │
│  │  │  - peer discovery                            │                     │  │
│  │  │  - entry exchange                            │                     │  │
│  │  │  - conflict-free merge                       │                     │  │
│  │  └────────────────────────────────────────────┘                     │  │
│  └──────────────────────────┬────────────────────────────────────────────┘  │
│                             │                                               │
│  ┌──────────────────────────▼────────────────────────────────────────────┐  │
│  │                      STORAGE LAYER                                    │  │
│  │  ┌──────────────────────────────────────────────┐                    │  │
│  │  │            StorageAdapter (interface)          │                    │  │
│  │  ├──────────────────┬───────────────────────────┤                    │  │
│  │  │  IndexedDB (web) │    SQLite (iOS/Android)    │                    │  │
│  │  └──────────────────┴───────────────────────────┘                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

                    ▲                             ▲
                    │ WebRTC (P2P direct)          │ WSS (relay fallback)
                    ▼                             ▼

          ┌─────────────┐              ┌──────────────────────┐
          │  Other Peer  │              │    RELAY SERVER       │
          │  (Client)    │              │                      │
          └─────────────┘              │  ┌────────────────┐  │
                                       │  │  Message Broker │  │
                                       │  │  (pub/sub)      │  │
                                       │  └───────┬────────┘  │
                                       │          │           │
                                       │  ┌───────▼────────┐  │
                                       │  │  Entry Cache    │  │
                                       │  │  (encrypted)    │  │
                                       │  └───────┬────────┘  │
                                       │          │           │
                                       │  ┌───────▼────────┐  │
                                       │  │  Invite Links   │  │
                                       │  │  (public meta)  │  │
                                       │  └────────────────┘  │
                                       └──────────────────────┘
```

## Component Responsibilities

### UI Layer
Standard React Native screens. Stateless; reads from the balance/ledger stores via hooks. All mutations go through the Business Logic Layer.

### Business Logic Layer

| Component | Responsibility |
|-----------|---------------|
| `LedgerEngine` | Append entries, validate chain integrity, maintain deterministic ordering |
| `IdentityManager` | Create/store root keypairs, authorize devices, handle social recovery ceremonies |
| `BalanceComputer` | Replay ordered ledger to derive current balances per member per group |
| `CryptoService` | Pure cryptographic primitives — signing, verification, hashing, encryption |

### Networking Layer

| Component | Responsibility |
|-----------|---------------|
| `P2PTransport` | Direct peer connections via libp2p over WebRTC data channels |
| `RelayTransport` | WebSocket connection to relay server for NAT-traversal fallback |
| `SyncManager` | Orchestrates sync: compares Lamport clocks, requests/sends missing entries |

### Storage Layer

| Component | Responsibility |
|-----------|---------------|
| `StorageAdapter` | Unified interface for persistence |
| `IndexedDBAdapter` | Web implementation using IndexedDB |
| `SQLiteAdapter` | Native implementation using expo-sqlite |

## Data Flow (Expense Creation)

```
User taps "Add Expense"
       │
       ▼
  UI dispatches action
       │
       ▼
  LedgerEngine.createExpense()
       ├── build ExpenseCreated payload
       ├── CryptoService.hash(entry)       → entry_id
       ├── CryptoService.sign(entry)        → signature
       ├── LedgerEngine.validate(entry)     → self-check
       ├── StorageAdapter.appendEntry(entry)
       │
       ▼
  SyncManager.broadcast(entry)
       ├── P2PTransport.send(entry)         → direct to online peers
       └── RelayTransport.send(encrypted)   → relay for offline peers
```
