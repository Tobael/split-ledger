export type {
    DeviceIdentity,
    Ed25519KeyPair,
    GroupId,
    Hash,
    PublicKey,
    RootIdentity,
    SecretKey,
    Signature,
} from "./types.js";

export {
    canonicalize,
    generateKeyPair,
    generateRandomBytes,
    hash,
    sign,
    verify,
} from "./crypto.js";

export { createDeviceIdentity, createRootIdentity } from './identity.js';
export { computeSettlements, type Settlement } from "./balance.js";
export {
    deriveGroupKey,
    encryptForRelay,
    decryptFromRelay,
    RelayTransport,
} from "./sync/index.js";
export type {
    Transport,
    TransportEntry,
    OnEntryHandler,
    OnConnectionStateHandler,
    RelayTransportOptions,
} from "./sync/index.js";
export * from "./protocol-v2/index.js";
