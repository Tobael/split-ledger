# Repository instructions

These instructions apply to the entire repository.

## Product direction

- Fair Money must remain a complete web application. Native applications are additional hosts, not replacements for the web client.
- Use the shared React and TypeScript frontend for the browser and Tauri 2 hosts.
- Target Tauri 2 for iOS, Android, macOS, Windows, and Linux after platform interfaces and protocol boundaries are stable.
- Use iOS Universal Links and Android App Links for invitations. Keep the HTTPS web join flow as the fallback when the app is not installed.
- Keep relay servers independently self-hostable and untrusted. They must not receive plaintext group data or private keys.
- Treat relays as disposable rendezvous caches, never as required durable group storage. Local group use must work without a relay.
- On reconnect, members must republish their locally retained encrypted operation set so an empty, replaced, or pruned relay can recover while any sufficiently complete member is online.
- When required history is unavailable, tell the user that another group member with that history needs to come online; do not report the group as corrupt or silently empty.
- Model people as stable participant slots so expenses can include people who have not joined yet.
- Support both targeted and generic revocable, single-use claim capabilities. A targeted invite fixes one participant slot; a generic invite lets its bearer choose one currently unclaimed participant slot when claiming. Treat wall-clock expiry as advisory until a trusted-time protocol exists.
- Remove social recovery and root-key recovery ceremonies. Do not silently remove identity export/import until that separate product decision is made.
- Preserve intentional identity transfer between devices, device enrollment/sharing, device revocation, and identity export/import. These are portability features, not social recovery.
- Delete only group-assisted or threshold recovery ceremonies; do not treat self-owned device transfer as legacy recovery code.
- Represent expense edits as immutable correction operations and deletions as tombstones.
- Replace the concurrent-unsafe linear hash chain with a versioned signed-operation model that explicitly supports offline concurrency.

## Implementation approach

- Follow `docs/design/14-product-rearchitecture-plan.md` for sequencing and current status.
- Prefer small vertical migrations over a big-bang Rust, Tauri, or protocol rewrite.
- Keep the web build working at every migration step.
- The application has never been deployed to production. Do not preserve backward compatibility with legacy APIs, protocols, storage formats, routes, or behavior.
- When replacement code exists, delete the superseded implementation, migration shim, compatibility branch, documentation, and tests instead of maintaining v1 and v2 side by side.
- Do not add data migrations for pre-release development data. A clean local reset is acceptable when formats change.
- Put browser APIs, Tauri APIs, storage, and link reception behind platform interfaces.
- Validate all untrusted data at network, deep-link, import, and storage boundaries.
- Preserve unrelated source changes in a dirty worktree; this does not mean preserving obsolete runtime formats or compatibility code.
- Run the relevant tests, full lint, production build, and `git diff --check` for completed slices.

## Documentation rules

- Treat `docs/design/` as the current intended architecture, not an archive of abandoned proposals.
- Update design documents and the re-architecture plan whenever an implementation decision changes them.
- Do not document React Native or Expo as the target platform.
- Do not document social recovery as a supported target feature.
- Never use ASCII-art diagrams, ASCII trees, ASCII timelines, or box-drawing characters.
- Use Mermaid for architecture, sequence, state, flow, dependency, and timeline diagrams.
- Use tables or prose when Mermaid would not improve understanding.
- Keep Mermaid node labels concise and avoid embedding secrets or realistic private keys in examples.
- Mark current implementation limitations separately from target behavior.

## Security language

- Say “signed, tamper-evident operation history,” not “blockchain,” unless consensus semantics are actually implemented.
- Do not claim production-grade security before an external cryptographic and protocol review.
- Never log private keys, claim secrets, invite tokens, decrypted payloads, or full public-key membership maps.
- State clearly that a malicious relay can delay, omit, replay, or reorder ciphertext even when it cannot forge valid operations.
