import type { DeviceIdentity, RootIdentity } from '@splitledger/core';

export interface IdentityStore {
    storeRootIdentity(identity: RootIdentity): Promise<void>;
    getRootIdentity(): Promise<RootIdentity | null>;
    storeDeviceIdentity(identity: DeviceIdentity): Promise<void>;
    getDeviceIdentity(): Promise<DeviceIdentity | null>;
    clearIdentity(): Promise<void>;
}
