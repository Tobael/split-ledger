# Library decisions

Dependencies are implementation tools, not protocol definitions. Signed bytes and validation behavior must be specified independently and covered by test vectors.

## Current baseline

| Area | Choice | Reason |
|---|---|---|
| Shared UI | React, React Router, Vite, shadcn/ui, Tailwind CSS | Reusable accessible primitives and one responsive frontend for web and Tauri hosts |
| Language | TypeScript | Shared browser, core, and relay implementation |
| Validation | Zod | Strict runtime validation at trust boundaries |
| Cryptography | Noble packages and Web Crypto | Auditable primitives with browser support |
| Tests | Vitest and fast-check | Unit, integration, and property testing |
| Relay HTTP | Hono | Small cross-runtime HTTP layer |
| Relay realtime | `ws` | WebSocket transport |
| Relay database | `better-sqlite3` | Simple self-hosted single-instance persistence |

## Target additions

| Area | Preferred choice | Notes |
|---|---|---|
| Native host | Tauri 2 | Wrap the same Vite/React frontend |
| Native links | Tauri deep-link plugin | iOS Universal Links and Android App Links |
| Native ledger | Tauri SQL plugin with SQLite | Must pass storage contract tests |
| Native secrets | OS-backed store through a reviewed Tauri plugin | Keep root secrets out of normal SQL/preferences |
| Web operation set | IndexedDB through `OperationStorageV2` | Clean v2-only database; projection state is derived rather than authoritative |
| Browser E2E | Playwright | Web join, persistence, offline, and sync flows |

## Selection rules

- Prefer maintained packages supporting the project's declared Node and browser versions.
- Pin native dependencies deliberately and allow required install scripts explicitly.
- libp2p, WebRTC, and the composite transport were deleted. Do not reintroduce them until a measured requirement justifies the complexity.
- Do not move protocol correctness into an ORM, UI framework, or platform plugin.
- Review licenses and security posture before adoption.
- Keep shadcn/ui components in the repository under `packages/web/src/components/ui`; migrate feature pages incrementally and delete superseded global component classes once their final consumer is gone.
