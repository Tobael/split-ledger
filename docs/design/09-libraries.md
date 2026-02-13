# 9. Recommended Libraries

## Core Platform

| Library | Purpose | Why |
|---------|---------|-----|
| [Expo SDK 52+](https://expo.dev) | Cross-platform framework | Unified build for iOS/Android/Web; managed workflow reduces native config |
| [React Native 0.76+](https://reactnative.dev) | UI runtime | Expo's underlying engine |
| [TypeScript 5.5+](https://typescriptlang.org) | Type safety | Strict mode catches data model errors at compile time |

## Cryptography

| Library | Purpose | Why |
|---------|---------|-----|
| [@noble/ed25519](https://github.com/paulmillr/noble-ed25519) | Ed25519 sign/verify | Pure JS, audited, zero dependencies, works in all environments |
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) | SHA-256, HKDF | Same author, same audit, consistent API |
| [@noble/curves](https://github.com/paulmillr/noble-curves) | X25519 ECDH key exchange | For encrypting entries for relay storage |

> [!IMPORTANT]
> The `noble` family is chosen over `tweetnacl` or `libsodium` because it is **pure TypeScript**, **audited**, and requires **no WASM or native modules** — critical for React Native + Web portability. It also has active maintenance and comprehensive test vectors.

## Storage

| Library | Purpose | Why |
|---------|---------|-----|
| [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) | SQLite on native | Expo-managed, synchronous API, WAL mode support |
| [idb](https://github.com/nicedoc/idb) | IndexedDB wrapper (web) | Promise-based, tiny, well-maintained |

## Networking

| Library | Purpose | Why |
|---------|---------|-----|
| [@libp2p/webrtc](https://github.com/libp2p/js-libp2p) | P2P data channels | Battle-tested WebRTC transport with NAT traversal; works in browser |
| [js-libp2p](https://github.com/libp2p/js-libp2p) | P2P framework | Modular: use only WebRTC transport + peer discovery |
| [ws](https://github.com/websockets/ws) (server) | WebSocket server | Fastest Node.js WebSocket implementation |
| [react-native-url-polyfill](https://github.com/nicedoc/react-native-url-polyfill) | URL parsing | Polyfill for consistent URL handling across platforms |

## Serialization & Validation

| Library | Purpose | Why |
|---------|---------|-----|
| [zod](https://github.com/colinhacks/zod) | Runtime schema validation | Validates entry payloads at trust boundaries; TypeScript-first |
| [canonicalize](https://www.npmjs.com/package/canonicalize) | RFC 8785 JSON canonicalization | Deterministic serialization for hashing/signing |

## State Management

| Library | Purpose | Why |
|---------|---------|-----|
| [zustand](https://github.com/pmndrs/zustand) | Client state management | Lightweight, React-compatible, no boilerplate |
| [react-query / TanStack Query](https://tanstack.com/query) | Async state (sync status, relay connection) | Caching, retry logic, background refetch |

## UI Components

| Library | Purpose | Why |
|---------|---------|-----|
| [react-native-paper](https://callstack.github.io/react-native-paper/) or [tamagui](https://tamagui.dev) | Cross-platform UI kit | Material Design 3 compliance; works on Web + native |
| [expo-camera](https://docs.expo.dev/versions/latest/sdk/camera/) | Receipt capture | Native camera integration |
| [expo-secure-store](https://docs.expo.dev/versions/latest/sdk/securestore/) | Key storage (native) | Hardware-backed Keychain/Keystore |
| [react-native-qrcode-svg](https://github.com/nicedoc/react-native-qrcode-svg) | QR codes for device auth | Render QR codes for key exchange |
| [expo-barcode-scanner](https://docs.expo.dev/versions/latest/sdk/bar-code-scanner/) | QR scanning | Scan device auth QR codes |

## Relay Server

| Library | Purpose | Why |
|---------|---------|-----|
| [Hono](https://hono.dev) | HTTP framework | Ultra-fast, works with Node/Bun/Deno, tiny bundle |
| [Drizzle ORM](https://orm.drizzle.team) | PostgreSQL ORM | TypeScript-first, SQL-like, excellent migrations |
| [ioredis](https://github.com/redis/ioredis) | Redis client | Pub/sub for real-time message forwarding |

## Testing

| Library | Purpose | Why |
|---------|---------|-----|
| [vitest](https://vitest.dev) | Unit & integration tests | Fast, native TypeScript, compatible with Jest API |
| [fast-check](https://github.com/dubzzz/fast-check) | Property-based testing | Critical for testing ledger validation edge cases |
| [Detox](https://wix.github.io/Detox/) | E2E testing (native) | gray-box testing for React Native |
| [Playwright](https://playwright.dev) | E2E testing (web) | Cross-browser testing |

## Development

| Library | Purpose | Why |
|---------|---------|-----|
| [turborepo](https://turbo.build) | Monorepo management | Fast builds, workspace-aware caching |
| [changesets](https://github.com/changesets/changesets) | Versioning | If publishing shared packages |
