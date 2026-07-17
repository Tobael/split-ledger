import { describe, expect, it } from "vitest";
import { createDeviceIdentity, createRootIdentity } from "../identity.js";

 describe("identity", () => {
    it("creates a root identity with a fresh signing key", () => {
        const identity = createRootIdentity("Alice");
        expect(identity.displayName).toBe("Alice");
        expect(identity.rootKeyPair.publicKey).toMatch(/^[0-9a-f]{64}$/);
        expect(identity.rootKeyPair.secretKey).toMatch(/^[0-9a-f]{64}$/);
        expect(identity.createdAt).toBeGreaterThan(0);
    });

    it("creates a distinct device key owned by the root identity", () => {
        const root = createRootIdentity("Alice");
        const device = createDeviceIdentity(root.rootKeyPair, "Alice phone");
        expect(device.deviceName).toBe("Alice phone");
        expect(device.rootPublicKey).toBe(root.rootKeyPair.publicKey);
        expect(device.deviceKeyPair.publicKey).toMatch(/^[0-9a-f]{64}$/);
        expect(device.deviceKeyPair.publicKey).not.toBe(root.rootKeyPair.publicKey);
    });
});
