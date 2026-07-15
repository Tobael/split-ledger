# Architecture

## System context

```mermaid
flowchart LR
    Messenger[Messenger or shared link] --> Link[HTTPS invite]
    Link -->|app installed| Native[Tauri client]
    Link -->|no app| Web[Web client]
    Native --> Core[Shared TypeScript core]
    Web --> Core
    Core --> Relay[Selected self-hosted relay]
    Relay --> Cipher[(Encrypted operations)]
    Core --> Service[v2 group service]
    Service --> WebStore[(v2 operation-set IndexedDB)]
    Core --> NativeStore[(SQLite and secure store)]
```

The HTTPS invite domain routes into the installed app through Universal Links or App Links and falls back to the web join page. It does not have to operate the selected relay.

## Client layers

| Layer | Responsibility |
|---|---|
| React UI | Groups, participants, expenses, balances, settings, and join flows |
| Application services | Commands, projections, authorization decisions, and sync orchestration |
| Protocol | Versioned schemas, canonical encoding, signatures, operation IDs, and validation |
| Platform adapters | Identity storage, ledger storage, link reception, sharing, and lifecycle |
| Transport | WebSocket relay protocol and reconnect behavior |

```mermaid
flowchart TD
    UI[Shared React UI] --> App[Application services]
    App --> Protocol[Protocol v2]
    App --> Storage[Storage interfaces]
    App --> Transport[Transport interface]
    Storage --> IndexedDB[Web IndexedDB]
    Storage --> TauriDB[Tauri SQLite and secure store]
    Transport --> WebSocket[Relay WebSocket]
```

## Trust boundaries

- Clients trust locally verified signatures and deterministic authorization rules.
- Relays are availability helpers, not authorities.
- Invite landing pages are routing helpers, not membership authorities.
- Imported files, deep links, relay envelopes, and persisted records are untrusted until validated.
- Native secure storage improves secret protection but does not make a compromised device trustworthy.

## Command lifecycle

```mermaid
sequenceDiagram
    actor User
    participant UI
    participant Core
    participant Store
    participant Relay
    User->>UI: Submit command
    UI->>Core: Validate intent and authorization
    Core->>Core: Build and sign operation
    Core->>Store: Persist locally
    Core-->>UI: Project updated state
    Core->>Relay: Publish encrypted operation
```

Local success does not depend on relay availability. Synchronization retries later.
