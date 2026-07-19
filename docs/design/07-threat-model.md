# Threat model

## Protected assets

- Expense descriptions, amounts, participants, and history.
- Identity and device private keys.
- Group encryption material and invite capability secrets.
- Integrity and deterministic interpretation of accepted operations.
- Availability sufficient for practical synchronization.

## Adversaries

| Adversary | Capabilities |
|---|---|
| Malicious relay | Observe metadata; delay, omit, replay, reorder, or delete ciphertext |
| Network attacker | Observe or alter traffic not protected by transport and message crypto |
| Malicious participant | Create authorized operations, share secrets, and attempt conflicts |
| Invite thief | Use a bearer claim secret before revocation or expiry |
| Compromised device | Read locally accessible secrets and act as that device |
| Resource attacker | Flood connections, groups, or oversized envelopes |
| Opaque-content abuser | Store unrelated encrypted or encoded material that the relay cannot classify |

## Security guarantees

- Relay ciphertext does not reveal valid group plaintext without the group key.
- Invalid signatures and unauthorized operations are rejected locally.
- Accepted history is tamper-evident.
- Targeted claim capabilities cannot claim a different slot or group.
- Honest clients with the same valid operation set converge.

## Explicit limitations

- A relay can censor or delete its ciphertext copy. Availability returns only when a member retaining the missing operations republishes them through an honest reachable relay.
- Traffic metadata can reveal timing, size, relay, and group activity patterns.
- A stolen, unlocked device can act with its available keys until revocation is observed.
- Forward secrecy is not guaranteed by a long-lived shared group key.
- Bearer invite secrets can be stolen before use.
- The browser cannot guarantee storage isolation equivalent to an OS secure store.
- No production-security claim should be made before external review.
- A syntactically valid new namespace and ciphertext envelope are not proof that the data was produced by Fair Money. A public relay cannot content-scan end-to-end encrypted payloads and must assume arbitrary opaque uploads.

## Mitigations

Use TLS, encrypted payloads, scoped capabilities, strict schemas, quotas, local durable storage, reconnect anti-entropy, explicit missing-member UX, device revocation, short-lived single-use invites, minimal logs, dependency review, and adversarial/property testing.

Storage ceilings limit disk exhaustion but can themselves be exhausted by the first abusive client. Before unrestricted public operation, add per-source namespace and upload-rate limits plus an abuse-resistant namespace-admission mechanism. Operators also need database-size alerts and a way to remove abusive namespaces without inspecting their contents.
