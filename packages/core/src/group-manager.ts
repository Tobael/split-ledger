// =============================================================================
// SplitLedger — Group Manager
// =============================================================================
//
// High-level orchestrator for group operations. Wraps the ledger engine,
// identity manager, and storage adapter into a clean user-facing API.
//

import type {
    DeviceIdentity,
    Ed25519KeyPair,
    ExpenseCreatedPayload,
    GroupId,
    GroupState,
    Hash,
    LedgerEntry,
    PublicKey,
    SecretKey,
    StorageAdapter,
} from './types.js';
import { EntryType } from './types.js';
import {
    buildEntry,
    orderEntries,
    validateFullChain,
} from './ledger.js';
import {
    createInviteToken,
    verifyInviteSignature,
    generateGroupId,
    createDeviceAuthorization,
    createRootRotationAuthorization,
} from './identity.js';
import { serializeInviteLink, parseInviteLink, type InviteLinkData } from './invite-link.js';

// ─── Types ───

export interface GroupManagerOptions {
    storage: StorageAdapter;
    deviceIdentity: DeviceIdentity;
    /** Root keypair — needed for invite signing, device auth. May be null in high-security mode. */
    rootKeyPair?: Ed25519KeyPair;
}

export interface CreateGroupResult {
    groupId: GroupId;
    genesisEntry: LedgerEntry;
    state: GroupState;
}

export interface JoinGroupResult {
    groupId: GroupId;
    memberAddedEntry: LedgerEntry;
    state: GroupState;
}

// ─── GroupManager ───

export class GroupManager {
    private storage: StorageAdapter;
    private device: DeviceIdentity;
    private rootKeyPair: Ed25519KeyPair | null;

    constructor(options: GroupManagerOptions) {
        this.storage = options.storage;
        this.device = options.deviceIdentity;
        this.rootKeyPair = options.rootKeyPair ?? null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Group Creation
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Create a new group. Generates genesis entry and stores it.
     */
    async createGroup(groupName: string, displayName?: string): Promise<CreateGroupResult> {
        const groupId = generateGroupId();

        const genesisEntry = buildEntry(
            EntryType.Genesis,
            {
                groupId,
                groupName,
                creatorRootPubkey: this.device.rootPublicKey,
                creatorDisplayName: displayName ?? this.device.deviceName,
            },
            null, // no previous hash
            0,    // lamport clock starts at 0
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(groupId, genesisEntry);

        // Derive state
        const state = await this.deriveGroupState(groupId);

        return { groupId, genesisEntry, state };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Invite Links
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Create a signed invite link for a group.
     * Requires root key pair access.
     */
    createInviteLink(
        groupId: GroupId,
        options: { relayUrl?: string; groupSecret?: string; ttlMs?: number } = {},
    ): string {
        if (!this.rootKeyPair) {
            throw new Error('Root key pair required to create invites');
        }

        const token = createInviteToken(groupId, this.rootKeyPair, options.ttlMs);

        return serializeInviteLink({
            token,
            relayUrl: options.relayUrl,
            groupSecret: options.groupSecret,
        });
    }

    /**
     * Parse an invite link without joining.
     */
    parseInviteLink(link: string): InviteLinkData {
        return parseInviteLink(link);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Join Group
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Join a group via an invite link.
     * Validates the invite, builds a MemberAdded entry, and appends it.
     *
     * Caller is responsible for syncing the group's ledger entries first
     * (via SyncManager) before calling this method.
     */
    async joinGroup(inviteLink: string, displayName?: string): Promise<JoinGroupResult> {
        const { token } = parseInviteLink(inviteLink);

        // Validate invite signature
        if (!verifyInviteSignature(token)) {
            throw new Error('Invalid invite: signature verification failed');
        }

        // Check expiry
        if (token.expiresAt < Date.now()) {
            throw new Error('Invalid invite: expired');
        }

        const groupId = token.groupId;

        // Get current chain state
        const entries = await this.storage.getAllEntries(groupId);
        if (entries.length === 0) {
            throw new Error('Cannot join group: no ledger entries found. Sync the group first.');
        }

        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;

        // Check inviter is an active member
        const state = await this.deriveGroupState(groupId);
        const inviter = state.members.get(token.inviterRootPubkey);
        if (!inviter || !inviter.isActive) {
            throw new Error('Invalid invite: inviter is not an active member');
        }

        // Check we're not already a member
        const existingMember = state.members.get(this.device.rootPublicKey);
        if (existingMember?.isActive) {
            throw new Error('Already a member of this group');
        }

        // Build MemberAdded entry
        const memberAddedEntry = buildEntry(
            EntryType.MemberAdded,
            {
                memberRootPubkey: this.device.rootPublicKey,
                memberDisplayName: displayName ?? this.device.deviceName,
                inviteToken: token,
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(groupId, memberAddedEntry);

        const updatedState = await this.deriveGroupState(groupId);

        return { groupId, memberAddedEntry, state: updatedState };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Member Removal
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Remove a member from a group.
     * The creator can remove any member; a member can remove themselves.
     */
    async removeMember(
        groupId: GroupId,
        memberRootPubkey: PublicKey,
        reason: string,
    ): Promise<LedgerEntry> {
        const state = await this.deriveGroupState(groupId);

        // Check target is an active member
        const member = state.members.get(memberRootPubkey);
        if (!member || !member.isActive) {
            throw new Error('Cannot remove: not an active member');
        }

        // Permission check: creator or self-removal
        const isSelf = memberRootPubkey === this.device.rootPublicKey;
        const isCreator = state.creatorRootPubkey === this.device.rootPublicKey;
        if (!isSelf && !isCreator) {
            throw new Error('Cannot remove member: insufficient permissions');
        }

        const entries = await this.storage.getAllEntries(groupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;

        const entry = buildEntry(
            EntryType.MemberRemoved,
            {
                memberRootPubkey,
                reason,
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(groupId, entry);
        return entry;
    }

    /**
     * Rename oneself in a group.
     */
    async renameMember(
        groupId: GroupId,
        newDisplayName: string,
    ): Promise<LedgerEntry> {
        const state = await this.deriveGroupState(groupId);

        // Check we're an active member
        const member = state.members.get(this.device.rootPublicKey);
        if (!member || !member.isActive) {
            throw new Error('Cannot rename member: not an active member');
        }

        const entries = await this.storage.getAllEntries(groupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;

        const entry = buildEntry(
            EntryType.MemberRenamed,
            {
                memberRootPubkey: this.device.rootPublicKey,
                newDisplayName,
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(groupId, entry);
        return entry;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Device Authorization
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Authorize a new device for the current user in a group.
     * Requires root key pair.
     */
    async authorizeDevice(
        groupId: GroupId,
        newDevicePubkey: PublicKey,
        deviceName: string,
    ): Promise<LedgerEntry> {
        if (!this.rootKeyPair) {
            throw new Error('Root key pair required to authorize devices');
        }

        const state = await this.deriveGroupState(groupId);

        // Check we're an active member
        const member = state.members.get(this.device.rootPublicKey);
        if (!member || !member.isActive) {
            throw new Error('Cannot authorize device: not an active member');
        }

        // Use the same timestamp for both the auth signature and the entry.
        // The validator reconstructs the signed payload using the entry timestamp.
        const timestamp = Date.now();

        // Create device authorization signature with authorizedAt = timestamp
        const auth = createDeviceAuthorization(
            this.rootKeyPair,
            newDevicePubkey,
            deviceName,
            timestamp,
        );

        const entries = await this.storage.getAllEntries(groupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;

        const entry = buildEntry(
            EntryType.DeviceAuthorized,
            {
                ownerRootPubkey: this.device.rootPublicKey,
                devicePublicKey: newDevicePubkey,
                deviceName,
                authorizationSignature: auth.authorizationSignature,
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
            timestamp,
        );

        await this.storage.appendEntry(groupId, entry);
        return entry;
    }

    /**
     * Revoke a device from the current user in a group.
     */
    async revokeDevice(
        groupId: GroupId,
        devicePubkey: PublicKey,
        reason: string,
    ): Promise<LedgerEntry> {
        const state = await this.deriveGroupState(groupId);

        // Check we're an active member
        const member = state.members.get(this.device.rootPublicKey);
        if (!member || !member.isActive) {
            throw new Error('Cannot revoke device: not an active member');
        }

        // Check the device belongs to us
        if (!member.authorizedDevices.has(devicePubkey)) {
            throw new Error('Cannot revoke device: device not found in your authorized devices');
        }

        const entries = await this.storage.getAllEntries(groupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;

        const entry = buildEntry(
            EntryType.DeviceRevoked,
            {
                ownerRootPubkey: this.device.rootPublicKey,
                devicePublicKey: devicePubkey,
                reason,
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(groupId, entry);
        return entry;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // State Queries
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Derive current group state by replaying the full ledger.
     */
    async deriveGroupState(groupId: GroupId): Promise<GroupState> {
        const entries = await this.storage.getAllEntries(groupId);
        if (entries.length === 0) {
            throw new Error(`No entries found for group ${groupId}`);
        }

        const result = validateFullChain(entries);
        if (!result.valid || !result.finalState) {
            throw new Error(`Invalid ledger chain: ${result.errors.map((e) => e.message).join(', ')}`);
        }

        return result.finalState;
    }

    /**
     * List all group IDs in storage.
     */
    async listGroups(): Promise<GroupId[]> {
        return this.storage.getGroupIds();
    }

    /**
     * Get group state if available.
     */
    async getGroupState(groupId: GroupId): Promise<GroupState | null> {
        try {
            const state = await this.deriveGroupState(groupId);
            // Cache state back to storage so SyncManager can see it
            await this.storage.saveGroupState(state);
            return state;
        } catch {
            return null;
        }
    }

    /**
     * Self-rotate the root key. This is used when a JSON backup is imported,
     * to immediately invalidate the old root key and switch to a new one.
     */
    async rotateRootKey(
        groupId: GroupId,
        oldRootSecretKey: SecretKey,
        newRootKeyPair: Ed25519KeyPair
    ): Promise<LedgerEntry> {
        if (!this.rootKeyPair) throw new Error("Root key pair required");

        const entries = await this.storage.getAllEntries(groupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;
        const state = await this.deriveGroupState(groupId);

        const member = state.members.get(this.rootKeyPair.publicKey);
        if (!member || !member.isActive) {
            throw new Error(`Cannot rotate root key: Member not active in group ${groupId}`);
        }

        const authorizationSignature = createRootRotationAuthorization(
            this.rootKeyPair.publicKey,
            newRootKeyPair.publicKey,
            groupId,
            oldRootSecretKey,
        );

        const entry = buildEntry(
            EntryType.SelfRootKeyRotation,
            {
                previousRootPubkey: this.rootKeyPair.publicKey,
                newRootPubkey: newRootKeyPair.publicKey,
                authorizationSignature,
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(groupId, entry);
        return entry;
    }

    /**
     * Void (delete/edit) an expense.
     * Appends an ExpenseVoided entry.
     */
    async voidExpense(groupId: GroupId, entryId: Hash, reason?: string): Promise<LedgerEntry> {
        const entries = await this.storage.getAllEntries(groupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;
        const state = await this.deriveGroupState(groupId);

        const entry = buildEntry(
            EntryType.ExpenseVoided,
            {
                voidedEntryId: entryId,
                reason,
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(groupId, entry);
        return entry;
    }

    /**
     * Replace an expense's effective data with one atomic, immutable correction.
     */
    async correctExpense(
        groupId: GroupId,
        entryId: Hash,
        correctedExpense: ExpenseCreatedPayload,
        reason = 'Edited',
    ): Promise<LedgerEntry> {
        const entries = await this.storage.getAllEntries(groupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1];
        if (!latestEntry) throw new Error(`No entries found for group ${groupId}`);

        const referencedEntry = entries.find((entry) => entry.entryId === entryId);
        if (!referencedEntry || (
            referencedEntry.entryType !== EntryType.ExpenseCreated &&
            referencedEntry.entryType !== EntryType.ExpenseCorrection
        )) {
            throw new Error('Cannot correct: expense entry not found');
        }

        const state = await this.deriveGroupState(groupId);
        const entry = buildEntry(
            EntryType.ExpenseCorrection,
            {
                referencedEntryId: entryId,
                correctionReason: reason,
                correctedExpense,
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(groupId, entry);
        return entry;
    }


    /**
     * Delete a group from local storage.
     * This does NOT revoke keys or notify other members (yet).
     */
    async deleteGroup(groupId: GroupId): Promise<void> {
        await this.storage.deleteGroup(groupId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Personal Device Sync (Group List)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Create/Update the personal sync group.
     * This group is used to sync the list of joined groups between devices.
     * ID = UUID derived from root pubkey (not cryptographically bound, just convention)
     */
    async ensurePersonalGroupExists(personalGroupId: GroupId): Promise<void> {
        const state = await this.getGroupState(personalGroupId);
        if (!state) {
            // Create deterministically using the root key pair so that all devices synced to this root key 
            // generate the exact same genesis block.
            if (!this.rootKeyPair) {
                console.warn("[GroupManager] Cannot ensure personal group without root key pair");
                return;
            }

            const genesisEntry = buildEntry(
                EntryType.Genesis,
                {
                    groupId: personalGroupId,
                    groupName: 'My Devices',
                    creatorRootPubkey: this.device.rootPublicKey,
                    creatorDisplayName: 'Me',
                },
                null,
                0, // Lamport clock 0
                this.device.rootPublicKey, // Use root pubkey as device pubkey so it's deterministic
                this.rootKeyPair.secretKey, // Sign with root secret so it's deterministic
                1 // Timestamp 1 (> 0) so hash is valid and deterministic
            );

            await this.storage.appendEntry(personalGroupId, genesisEntry);
            await this.deriveGroupState(personalGroupId);
        }

        // Now that the group exists (either just created or already existed), ensure THIS device is authorized.
        const currentState = await this.getGroupState(personalGroupId);
        if (currentState) {
            const me = currentState.members.get(this.device.rootPublicKey);
            if (me && me.isActive && !me.authorizedDevices.has(this.device.deviceKeyPair.publicKey)) {
                console.log(`[GroupManager] Auto-authorizing device for personal group ${personalGroupId}`);
                try {
                    // Try to authorize our own device
                    await this.authorizeDevice(personalGroupId, this.device.deviceKeyPair.publicKey, this.device.deviceName);
                } catch (authErr) {
                    console.warn(`[GroupManager] Failed to auto-authorize device for personal group`, authErr);
                }
            }
        }
    }

    async announceGroupJoin(personalGroupId: GroupId, groupId: GroupId, groupName: string, currency: string): Promise<LedgerEntry> {
        const entries = await this.storage.getAllEntries(personalGroupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;
        const state = await this.deriveGroupState(personalGroupId); // Re-derive to get clock

        const entry = buildEntry(
            EntryType.GroupJoined,
            {
                groupId,
                groupName,
                currency,
                joinedAt: Date.now(),
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(personalGroupId, entry);
        return entry;
    }

    async announceGroupLeave(personalGroupId: GroupId, groupId: GroupId): Promise<LedgerEntry> {
        const entries = await this.storage.getAllEntries(personalGroupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;
        const state = await this.deriveGroupState(personalGroupId);

        const entry = buildEntry(
            EntryType.GroupLeft,
            {
                groupId,
                leftAt: Date.now(),
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(personalGroupId, entry);
        return entry;
    }
}
