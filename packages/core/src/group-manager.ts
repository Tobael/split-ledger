// =============================================================================
// SplitLedger — Group Manager
// =============================================================================
//
// High-level orchestrator for group operations. Wraps the ledger engine,
// identity manager, and storage adapter into a clean user-facing API.
//

import type {
    CoSignature,
    DeviceIdentity,
    Ed25519KeyPair,
    GroupId,
    GroupState,
    LedgerEntry,
    PublicKey,
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
} from './identity.js';
import { serializeInviteLink, parseInviteLink, type InviteLinkData } from './invite-link.js';
import { RecoveryManager, type RecoveryRequest } from './recovery-manager.js';

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

    // ═══════════════════════════════════════════════════════════════════════
    // Recovery (delegates to RecoveryManager)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Initiate a root key recovery ceremony.
     * Returns a RecoveryRequest to share with group members.
     */
    initiateRecovery(groupId: GroupId, previousRootPubkey?: PublicKey): RecoveryRequest {
        return this.getRecoveryManager().initiateRecovery(groupId, previousRootPubkey);
    }

    /**
     * Create a co-signature to help another member recover their root key.
     */
    contributeRecoverySignature(request: RecoveryRequest): CoSignature {
        return this.getRecoveryManager().createCoSignature(request);
    }

    /**
     * Complete a recovery ceremony with collected co-signatures.
     */
    async completeRecovery(
        request: RecoveryRequest,
        coSignatures: CoSignature[],
    ): Promise<LedgerEntry> {
        return this.getRecoveryManager().completeRecovery(request, coSignatures);
    }

    /**
     * Get the recovery threshold for a group.
     */
    async getRecoveryThreshold(groupId: GroupId, recoveringMember: PublicKey): Promise<number> {
        return this.getRecoveryManager().getRecoveryThreshold(groupId, recoveringMember);
    }

    private getRecoveryManager(): RecoveryManager {
        return new RecoveryManager({
            storage: this.storage,
            deviceIdentity: this.device,
            rootKeyPair: this.rootKeyPair ?? undefined,
        });
    }
}
