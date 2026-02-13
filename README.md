# SplitLedger

Cryptographically secure, peer-to-peer expense splitting. No accounts, no central servers storing your data — just end-to-end encrypted, hash-chained ledgers synced between devices.

## Features

- **End-to-end encrypted** — all entries are encrypted before leaving your device
- **Hash-chained ledger** — tamper-evident log of all group activity
- **No account required** — identity is a cryptographic key pair generated on your device
- **Multi-device sync** — sync via relay server (WebSocket) with offline support
- **Social recovery** — recover access via trusted group members
- **Multi-language** — English and German (default)

## Architecture

```
packages/
  core/     — cryptography, ledger engine, sync, balance computation
  relay/    — Node.js relay server (Hono REST + WebSocket)
  web/      — React SPA (Vite)
```

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Build core library
npm run build --workspace=packages/core

# Start relay server (port 8443)
npm run dev --workspace=packages/relay

# Start web app (port 5173, proxies to relay)
npm run dev --workspace=packages/web
```

### Production (Docker Compose)

```bash
docker compose up -d --build
```

This starts:
- **Relay server** on port `8443` (WebSocket + REST API)
- **Web frontend** on port `8080` (nginx, proxies WS/API to relay)

SQLite data is persisted in a Docker volume (`relay-data`).

## Deployment

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) deploys via:
1. WireGuard VPN connection
2. rsync to the server
3. `docker compose up -d --build --remove-orphans`

Required GitHub Secrets:
| Secret | Description |
|--------|-------------|
| `WIREGUARD_CONF` | WireGuard client config |
| `DEPLOY_SECRET_KEY` | SSH private key |
| `SSH_HOST` | Target server hostname |
| `SSH_USER` | SSH username |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Core crypto | Ed25519 (TweetNaCl), SHA-256, HKDF |
| Ledger | Hash-chained entries with Lamport clocks |
| Frontend | React, Vite, vanilla CSS |
| Backend | Hono (REST), ws (WebSocket), better-sqlite3 |
| Deployment | Docker Compose, nginx |

## License

Private — all rights reserved.
