# Self-hosting a relay

Fair Money relays are untrusted encrypted mailboxes. An operator can observe group namespaces, ciphertext sizes, timing, IP addresses, and traffic volume, but does not receive group plaintext, group secrets, claim secrets, or identity private keys. A malicious or broken relay can still delay, omit, replay, reorder, or permanently delete ciphertext.

## Requirements

- Docker with Compose v2
- A DNS name for public use
- A TLS-terminating reverse proxy supporting WebSocket upgrades
- Persistent local storage for one SQLite database

Public browser and native clients should use `wss://`. The reference Compose file binds the relay to loopback so clients cannot bypass the TLS proxy.

## Start the relay

```bash
cp .env.relay.example .env.relay
docker compose --env-file .env.relay -f docker-compose.relay.yml up -d --build
docker compose --env-file .env.relay -f docker-compose.relay.yml ps
curl --fail http://127.0.0.1:8443/api/v2/health
```

The health response confirms that the HTTP process and SQLite database opened. It does not prove that public DNS, TLS, WebSocket forwarding, or a client capability works.

Configure a reverse proxy for the loopback port. For example, Caddy automatically forwards WebSocket upgrades:

```caddyfile
relay.example.org {
    reverse_proxy 127.0.0.1:8443
}
```

The client relay URL is then `wss://relay.example.org/ws`. Test the public health route at `https://relay.example.org/api/v2/health` as well.

## Selecting a relay in the web application

Each browser can choose the relay used when it creates new groups. Open **Settings**, find **Relay server**, enter a secure WebSocket URL such as `wss://relay.example.org/ws`, and save it. This preference is local to that browser.

Changing the preference does not silently move existing groups. Their invites and locally stored group-access records retain the relay selected when the group was created. Relay migration requires an explicit protocol operation so every member converges on the same destination.

Members joining through an invite do not configure its relay manually: the signed invite carries that group's relay URL and opaque access capability. The relay receives ciphertext and cannot derive group plaintext or private keys.

For the reference deployment behind Traefik, ensure the public router has a higher priority than any catch-all or blackhole router and supports WebSocket upgrades. For example:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.fair-money-relay.rule=Host(`relay.example.org`)
  - traefik.http.routers.fair-money-relay.entrypoints=websecure
  - traefik.http.routers.fair-money-relay.priority=100
  - traefik.http.routers.fair-money-relay.tls=true
  - traefik.http.routers.fair-money-relay.service=fair-money-relay
  - traefik.http.services.fair-money-relay.loadbalancer.server.port=8443
  - traefik.docker.network=external_network
```

Traefik forwards WebSocket upgrades without a separate `/ws` router or middleware. Verify both paths after deployment:

```bash
curl --fail https://relay.example.org/api/v2/health
npx wscat -c wss://relay.example.org/ws
```

## Configuration

| Variable | Default | Meaning |
|---|---:|---|
| `RELAY_PORT` | `8443` | Loopback host port in the reference Compose file |
| `MAX_OPERATION_SIZE_BYTES` | `65536` | Maximum decoded ciphertext bytes in one operation envelope |
| `MAX_OPERATIONS_PER_GROUP` | `1000000` | Stored-operation ceiling for one opaque group namespace |
| `MAX_CONNECTIONS_PER_IP` | `50` | Concurrent WebSocket limit per resolved client address |
| `TRUST_PROXY` | `true` in Compose | Trust the first `X-Forwarded-For` address for connection limiting |
| `WS_IDLE_TIMEOUT_MS` | `300000` | Close WebSockets that send no messages during this interval |
| `PAGE_SIZE` | `500` | Maximum operations returned by one cursor page |
| `OPERATION_RETENTION_DAYS` | `0` | `0` retains ciphertext indefinitely; a positive value enables permanent hourly pruning |

`TRUST_PROXY=true` is safe only when the relay port is reachable exclusively through a trusted proxy that replaces or sanitizes `X-Forwarded-For`. Keep it false for direct exposure. If multiple proxies are involved, enforce connection limits at the edge instead of trusting an ambiguous forwarded chain.

Retention is deliberately disabled by default while complete reconnect anti-entropy is still being connected. The target protocol republishes a member's retained encrypted operation set whenever that member comes online, allowing an empty or pruned relay to recover. Until that behavior is implemented for every group, enabling retention can strand a device that is missing history.

## Backup

Stop the relay before copying SQLite so the database and any write-ahead-log state form one consistent snapshot:

```bash
docker compose --env-file .env.relay -f docker-compose.relay.yml stop relay
mkdir -p relay-backup
docker cp "$(docker compose --env-file .env.relay -f docker-compose.relay.yml ps -q relay):/app/data/." relay-backup/
docker compose --env-file .env.relay -f docker-compose.relay.yml start relay
```

Encrypt backups and apply access controls. Relay data is ciphertext, but metadata and capability-protected group namespaces remain sensitive. Test restoration periodically on a separate host.

## Restore

Restoration replaces the current relay database. Keep the relay stopped throughout the operation:

```bash
docker compose --env-file .env.relay -f docker-compose.relay.yml stop relay
docker compose --env-file .env.relay -f docker-compose.relay.yml run --rm --no-deps --entrypoint sh relay -c 'rm -f /app/data/relay.db /app/data/relay.db-shm /app/data/relay.db-wal'
docker cp relay-backup/. "$(docker compose --env-file .env.relay -f docker-compose.relay.yml ps -q relay):/app/data/"
docker compose --env-file .env.relay -f docker-compose.relay.yml start relay
curl --fail http://127.0.0.1:8443/api/v2/health
```

Clients cryptographically validate downloaded operations after a restore. A restored relay may temporarily omit operations published after the snapshot.

## Upgrade

```bash
git pull --ff-only
docker compose --env-file .env.relay -f docker-compose.relay.yml build --pull relay
docker compose --env-file .env.relay -f docker-compose.relay.yml up -d relay
docker compose --env-file .env.relay -f docker-compose.relay.yml ps
curl --fail http://127.0.0.1:8443/api/v2/health
```

Read release notes before upgrading. Protocol-v2 pre-release deployments do not receive migrations from abandoned v1 databases; the application has not shipped to production, so obsolete formats are deleted instead of supported indefinitely.

## Operational boundaries

- Run one relay process per SQLite volume. Do not mount the same database into multiple containers.
- Monitor disk space, restart count, health failures, connection count, and database growth.
- Put request-rate and bandwidth limits at the reverse proxy. The relay currently enforces envelope size, per-group storage, per-IP connection, idle connection, and page-size limits, but not publish requests per time window.
- Do not log query strings, WebSocket payloads, invite URLs, capabilities, or decrypted client data.
- Losing the relay database loses only the server's ciphertext copy. Any member retaining the required local history can republish it; clients missing history must explain that such a member needs to come online.
