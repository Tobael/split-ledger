import { generateKeyPair } from './crypto.js';
import type { DeviceIdentity, Ed25519KeyPair, RootIdentity } from './types.js';

export function createRootIdentity(displayName: string): RootIdentity {
    return { rootKeyPair: generateKeyPair(), displayName, createdAt: Date.now() };
}

export function createDeviceIdentity(rootKeyPair: Ed25519KeyPair, deviceName: string): DeviceIdentity {
    const deviceKeyPair = generateKeyPair();
    return {
        deviceKeyPair,
        rootPublicKey: rootKeyPair.publicKey,
        deviceName,
    };
}
