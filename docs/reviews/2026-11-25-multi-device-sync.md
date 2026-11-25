# Multi-device functional review — 2026-11-25

Scope: the shared web application's identity transfer, automatic group discovery, relay synchronization, invite preparation/claiming, local storage, device list, revocation, and related UI. Findings cover concrete broken flows; they are not an external cryptographic protocol review.

| Priority | Finding and consequence | Implemented correction |
|---|---|---|
| P1 | Devices knew only the group IDs from the exported snapshot; later groups were never discovered. | Encrypted identity-private directory, persistent signed group access records, device registry, and automatic discovery before per-group sync. |
| P1 | Access-only imports depended on complete relay history; groups without local operations disappeared from retry enumeration. | Complete validated offline snapshot; enumerate both retained access and operations; show discovered groups awaiting member history. |
| P1 | Missing remote parents returned before local republication, preventing a complete local member from healing a pruned relay. | Republish retained operations even after incomplete reads; validate and merge a second read. |
| P1 | A never-completing WebSocket handshake could leave sync, import, or deletion stuck indefinitely. | Handshake deadline, early-close/cancellation rejection, and retry tests. |
| P1 | Revocation affected only locally known groups; normal root-signed administration bypassed the selected device's revocation. | Permanent identity-wide revocation records, materialization in newly discovered groups, active-device signatures for normal administration, and no automatic reenrollment/discovery for revoked devices. |
| P1 | Identity and group replacement used separate databases; failures could leave a mixed identity and ledger. | Unified browser database and atomic snapshot replacement, with validated root/device ownership. Remove the superseded identity adapter. |
| P1 | Invite preparation overwrote retained access before proving that the invitation matched local history. | Reject conflicting stored access without changing existing keys or relay capability. |
| P2 | WebSocket send was treated as confirmed publication, including disconnected sends and relay rejection. | Disconnected writes reject, relay errors reject pending reads, and a validating publication read detects missing records. |
| P2 | Relay-controlled cursors could loop without advancing; malformed response shapes could throw in event handling. | Validate wire schemas and cursor progress; malformed responses remain bounded by request deadlines. |
| P2 | Local group deletion could be undone by directory discovery or an in-flight sync response. | Persist local suppression; drain active sync before deletion. Suppression remains local to the deleting device. |
| P2 | One unavailable relay blocked later groups; partial sync could leave stale group/device UI. | Independent group synchronization with aggregate failure reporting and refresh from durable state each round. |
| P2 | Local edits, invitation creation, claims, and revocations reported failure after already being saved when relay publication failed. | Local success is distinct from background publication; queue reconnect retries and preserve generated invitation URLs. |
| P2 | Commands arriving during a sync round could miss that round's directory/group enumeration. | Coalesce requests and schedule a follow-up round. |
| P2 | Large encrypted snapshots exceeded JavaScript's spread-argument limit. | Chunk base64 conversion; test a one-megabyte round trip. |
| P2 | Merely previewing an unrelated invitation could prevent exporting an otherwise valid identity. | Exclude unclaimed invitation previews; still reject exports missing required owned-group history. |

## Validation

Automated regressions cover separate IndexedDB device stores, post-transfer discovery in both directions, concurrent edits and corrections, empty/pruned relay healing, unknown groups at revocation, suppression after local deletion, directory relay failure, forged directory records, dropped publication, invalid key pairs, and durable atomic identity replacement. An additional integration test runs the production identity synchronizer through a real relay with proof-of-work admission and cursor pagination.

## Remaining boundaries

- Root keys are copied during file transfer. A malicious holder of that root can authorize a fresh key; device-key revocation is not root-key revocation. Root-isolated enrollment requires a separate protocol change. The honest client enforces permanent device revocation and does not erase downloaded data.
- A malicious relay can delay, omit, replay, or reorder ciphertext even when it cannot forge valid operations. Discovery requires directory connectivity; missing group history requires a sufficiently complete member to come online.
- Physical iOS/Android and browser-profile release checks remain pending in the manual test plan. Automated transport and storage tests do not establish physical-device behavior.
- Pre-release storage and transfer formats have no compatibility or migration guarantee. The updated schema uses a clean local reset; obsolete access-only exports cannot supply the missing discovery material.
