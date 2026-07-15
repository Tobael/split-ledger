# Fair Money

**Private, offline-first expense splitting with a signed operation history.**

Fair Money is a privacy-first application for managing shared expenses. It uses end-to-end encryption and signed, tamper-evident operations so relay servers cannot read group contents or forge valid changes.

## Features

-   **🔒 End-to-End Encrypted**: Data is encrypted on your device before it ever touches the network.
-   **🛡️ Tamper-Evident**: Uses signed, content-addressed operations to detect unauthorized history changes.
-   **👤 No Accounts**: Identity is a cryptographic key pair generated locally.
-   **⚡ Real-Time Sync**: Syncs instantly across devices via a relay server (WebSocket).
-   **📱 Offline First**: Works fully offline; syncs when you reconnect.

## Documentation

We believe in transparency. Here is exactly how the security and synchronization work:

-   [**Product & Re-architecture Plan**](docs/design/14-product-rearchitecture-plan.md) - Current handoff for the web, Tauri, invitation, participant-slot, relay, and recovery direction.
-   [**Protocol v2 Specification**](docs/protocol/v2/README.md) - Normative signed-operation format, authorization rules, and compatibility vectors.
-   [**Architecture & Design**](docs/design/01-architecture.md)
-   [**User Flow: Group Creation**](docs/flows/01-group-creation.md) - How keys and groups are securely born.
-   [**User Flow: Invitation & Join**](docs/flows/02-invitation-join.md) - How we securely invite others without exposing keys.
-   [**User Flow: Adding Expenses**](docs/flows/03-adding-expense.md) - How the ledger ensures integrity and ordering.
-   [**User Flow: Synchronization**](docs/flows/04-synchronization.md) - How devices stay in sync via an untrusted relay.
-   [**Self-hosting a Relay**](docs/relay-self-hosting.md) - Reference Compose deployment, configuration, backups, retention, and upgrades.
-   [**Manual Web Release Test Plan**](docs/manual-web-test-plan.md) - Cross-device, invitation, relay-recovery, transfer, and iOS checks required before Tauri work.

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
