# 6. Relay Server Minimal Specification

## Role

The relay server is an **untrusted message broker and entry cache**. It:

- Stores encrypted ledger entries for offline peers
- Forwards real-time messages between peers that cannot establish direct WebRTC connections
- Hosts invite link metadata for deep-link resolution
- **Does NOT validate** entries (clients do all validation)
- **Cannot read** entry contents (entries are encrypted at rest)

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (Fastify or Hono) |
| Real-time | WebSocket (ws library) |
| Storage | PostgreSQL (entries) + Redis (pub/sub, sessions) |
| Auth | Group-scoped bearer tokens (HMAC of groupId + memberPubkey) |

## API Specification

### WebSocket Protocol

Connection: `wss://relay.splitledger.app/ws?groupId={groupId}&token={authToken}`

#### Client → Server Messages

```json
{ "type": "PUBLISH_ENTRY",     "groupId": "...", "encryptedEntry": "base64..." }
{ "type": "GET_ENTRIES_AFTER",  "groupId": "...", "afterLamportClock": 42 }
{ "type": "GET_FULL_LEDGER",    "groupId": "..." }
{ "type": "PING" }
```

#### Server → Client Messages

```json
{ "type": "NEW_ENTRY",          "groupId": "...", "encryptedEntry": "base64..." }
{ "type": "ENTRIES_RESPONSE",   "groupId": "...", "entries": ["base64...", "..."] }
{ "type": "FULL_LEDGER",        "groupId": "...", "entries": ["base64...", "..."] }
{ "type": "PONG" }
{ "type": "ERROR",              "code": "...",    "message": "..." }
```

### REST API

#### Invite Links

```
POST /api/v1/invites
  Body: { groupId, inviteData: "base64...", expiresAt }
  Response: { inviteId, shortUrl }

GET /api/v1/invites/:inviteId
  Response: { groupId, inviteData: "base64...", expiresAt }

DELETE /api/v1/invites/:inviteId
  Auth: must be the invite creator
```

#### Health & Discovery

```
GET /api/v1/health
  Response: { status: "ok", version: "1.0.0", connectedPeers: 42 }

GET /api/v1/groups/:groupId/peers
  Response: { peers: [{ peerId, lastSeen }] }
```

## Storage Schema

```sql
CREATE TABLE encrypted_entries (
  id              BIGSERIAL PRIMARY KEY,
  group_id        UUID NOT NULL,
  lamport_clock   BIGINT NOT NULL,
  encrypted_data  BYTEA NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sender_pubkey   TEXT NOT NULL,
  UNIQUE(group_id, lamport_clock, sender_pubkey)
);

CREATE INDEX idx_entries_group_lamport ON encrypted_entries(group_id, lamport_clock);

CREATE TABLE invites (
  invite_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL,
  invite_data     BYTEA NOT NULL,
  creator_pubkey  TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invites_expiry ON invites(expires_at);
```

## Group Encryption for Relay Storage

Entries stored on the relay are encrypted with a symmetric group key derived via HKDF:

```
groupEncryptionKey = HKDF-SHA256(
  ikm: sharedGroupSecret,         // established during group creation
  salt: groupId,
  info: "splitledger-relay-encryption",
  length: 32
)
```

The `sharedGroupSecret` is distributed to new members as part of the join flow (encrypted to their root public key using X25519/ECDH key exchange).

## Rate Limits & Quotas

| Resource | Limit |
|----------|-------|
| Entries per group per hour | 1,000 |
| Max entry size | 64 KB |
| Max groups per relay | 100,000 |
| Max entries per group | 1,000,000 |
| WebSocket idle timeout | 5 minutes (with PING/PONG keepalive) |
| Max concurrent connections per IP | 50 |

## Deployment

```yaml
# docker-compose.yml (minimal)
services:
  relay:
    image: splitledger/relay:latest
    ports: ["8443:8443"]
    environment:
      DATABASE_URL: postgres://relay:pass@db:5432/splitledger
      REDIS_URL: redis://redis:6379
      TLS_CERT: /certs/cert.pem
      TLS_KEY: /certs/key.pem
    depends_on: [db, redis]

  db:
    image: postgres:16-alpine
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine

volumes:
  pgdata:
```

## Data Retention

- Encrypted entries: retained for **90 days** after last access, then pruned
- Active groups (any member connected in last 30 days): entries retained indefinitely
- Expired invites: pruned daily via cron
- The relay is **disposable**: if all data is lost, clients still hold the full ledger and can re-populate the cache
