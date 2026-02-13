// =============================================================================
// SplitLedger — In-Memory Storage Adapter
// =============================================================================
//
// Test/development implementation of StorageAdapter.
// For production: IndexedDB (web) or SQLite (native) adapters.
//

import type {
    DeviceIdentity,
    GroupId,
    GroupState,
    Hash,
    LedgerEntry,
    RootIdentity,
    StorageAdapter,
} from './types.js';

export class InMemoryStorageAdapter implements StorageAdapter {
    private entries = new Map<Hash, { groupId: GroupId; entry: LedgerEntry }>();
    private groupEntries = new Map<GroupId, LedgerEntry[]>();
    private rootIdentity: RootIdentity | null = null;
    private deviceIdentity: DeviceIdentity | null = null;
    private groupStates = new Map<GroupId, GroupState>();

    // --- Ledger operations ---

    async appendEntry(groupId: GroupId, entry: LedgerEntry): Promise<void> {
        if (this.entries.has(entry.entryId)) {
            // Deduplication: silently ignore duplicate entries
            return;
        }
        this.entries.set(entry.entryId, { groupId, entry });
        const list = this.groupEntries.get(groupId) ?? [];
        list.push(entry);
        this.groupEntries.set(groupId, list);
    }

    async getEntry(entryId: Hash): Promise<LedgerEntry | null> {
        return this.entries.get(entryId)?.entry ?? null;
    }

    async getEntriesAfter(groupId: GroupId, afterLamportClock: number): Promise<LedgerEntry[]> {
        const list = this.groupEntries.get(groupId) ?? [];
        return list.filter((e) => e.lamportClock > afterLamportClock);
    }

    async getLatestEntry(groupId: GroupId): Promise<LedgerEntry | null> {
        const list = this.groupEntries.get(groupId) ?? [];
        if (list.length === 0) return null;
        return list[list.length - 1] ?? null;
    }

    async getAllEntries(groupId: GroupId): Promise<LedgerEntry[]> {
        return this.groupEntries.get(groupId) ?? [];
    }

    // --- Identity operations ---

    async storeRootIdentity(identity: RootIdentity): Promise<void> {
        this.rootIdentity = identity;
    }

    async getRootIdentity(): Promise<RootIdentity | null> {
        return this.rootIdentity;
    }

    async storeDeviceIdentity(identity: DeviceIdentity): Promise<void> {
        this.deviceIdentity = identity;
    }

    async getDeviceIdentity(): Promise<DeviceIdentity | null> {
        return this.deviceIdentity;
    }

    // --- Group metadata ---

    async getGroupIds(): Promise<GroupId[]> {
        return Array.from(this.groupEntries.keys());
    }

    async getGroupState(groupId: GroupId): Promise<GroupState | null> {
        return this.groupStates.get(groupId) ?? null;
    }

    async saveGroupState(state: GroupState): Promise<void> {
        this.groupStates.set(state.groupId, state);
    }

    // --- Test helpers ---

    clear(): void {
        this.entries.clear();
        this.groupEntries.clear();
        this.rootIdentity = null;
        this.deviceIdentity = null;
        this.groupStates.clear();
    }
}
