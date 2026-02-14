# SplitLedger

**Cryptographically secure, peer-to-peer expense splitting.**

SplitLedger is a privacy-first application for managing shared expenses. It uses end-to-end encryption and a tamper-evident hash chain to ensure that your financial data remains yours. No accounts, no central servers reading your data, just math.

## Features

-   **🔒 End-to-End Encrypted**: Data is encrypted on your device before it ever touches the network.
-   **🛡️ Tamper-Evident**: Uses a blockchain-like hash chain to prevent history rewriting.
-   **👤 No Accounts**: Identity is a cryptographic key pair generated locally.
-   **⚡ Real-Time Sync**: Syncs instantly across devices via a relay server (WebSocket).
-   **📱 Offline First**: Works fully offline; syncs when you reconnect.

## Documentation

We believe in transparency. Here is exactly how the security and synchronization work:

-   [**Architecture & Design**](docs/design/01-architecture.md)
-   [**User Flow: Group Creation**](docs/flows/01-group-creation.md) - How keys and groups are securely born.
-   [**User Flow: Invitation & Join**](docs/flows/02-invitation-join.md) - How we securely invite others without exposing keys.
-   [**User Flow: Adding Expenses**](docs/flows/03-adding-expense.md) - How the ledger ensures integrity and ordering.
-   [**User Flow: Synchronization**](docs/flows/04-synchronization.md) - How devices stay in sync via an untrusted relay.

## Architecture Overview

```mermaid
graph TD
    subgraph Client [User Device (Browser)]
        UI[React UI]
        Logic[Business Logic]
        Crypto[Crypto Engine (Ed25519/ChaCha20)]
        Store[Local Storage (IndexedDB/LS)]
        
        UI --> Logic
        Logic --> Crypto
        Logic --> Store
    end
    
    subgraph Network
        Relay[Relay Server (Node.js/Hono)]
        DB[(Relay DB)]
        
        Relay --> DB
    end
    
    Client -- "Encrypted Blobs (WebSocket)" --> Relay
    
    style Client fill:#f9f,stroke:#333
    style Relay fill:#bbf,stroke:#333
    style Crypto fill:#bfb,stroke:#333
```

## Quick Start (Development)

To run the project locally for development:

```bash
# 1. Install dependencies
npm install

# 2. Build core library
npm run build --workspace=packages/core

# 3. Start Relay Server (Port 8443)
npm run dev --workspace=packages/relay

# 4. Start Web Client (Port 5173)
npm --workspace=packages/web run dev -- --host
```

Open `http://localhost:5173` in your browser.

## License

Private — All rights reserved.
