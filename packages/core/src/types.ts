// Shared protocol primitives.

export type PublicKey = string & { readonly __brand: "PublicKey" };
export type SecretKey = string & { readonly __brand: "SecretKey" };
export type Signature = string & { readonly __brand: "Signature" };
export type Hash = string & { readonly __brand: "Hash" };
export type GroupId = string & { readonly __brand: "GroupId" };

export interface Ed25519KeyPair {
    publicKey: PublicKey;
    secretKey: SecretKey;
}

export interface RootIdentity {
    rootKeyPair: Ed25519KeyPair;
    displayName: string;
    createdAt: number;
}

export interface DeviceIdentity {
    deviceKeyPair: Ed25519KeyPair;
    rootPublicKey: PublicKey;
    deviceName: string;
}
