import type { DeviceIdentity, RootIdentity, GroupAccessV2 } from '@splitledger/core';

export interface StoredRootIdentity extends RootIdentity { directoryAccess: GroupAccessV2 }
export interface StoredIdentity { root: StoredRootIdentity; device: DeviceIdentity }

export interface IdentityStore {
    loadIdentity(): Promise<StoredIdentity | null>;
    saveIdentity(identity: StoredIdentity): Promise<void>;
}
