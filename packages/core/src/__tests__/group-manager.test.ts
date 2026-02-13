// =============================================================================
// GroupManager — Unit Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { GroupManager } from '../group-manager.js';
import { InMemoryStorageAdapter } from '../storage.js';
import { createRootIdentity, createDeviceIdentity, createInviteToken } from '../identity.js';
import { serializeInviteLink } from '../invite-link.js';
import { generateKeyPair } from '../crypto.js';
import type { PublicKey, GroupId, Signature } from '../types.js';

// ─── Test Helpers ───

function createTestUser(name: string) {
    const root = createRootIdentity(name);
    const device = createDeviceIdentity(root.rootKeyPair, `${name}'s device`);
    return { root, device };
}

describe('GroupManager', () => {
    let storage: InMemoryStorageAdapter;
    let alice: ReturnType<typeof createTestUser>;
    let bob: ReturnType<typeof createTestUser>;
    let aliceManager: GroupManager;

    beforeEach(() => {
        storage = new InMemoryStorageAdapter();
        alice = createTestUser('Alice');
        bob = createTestUser('Bob');
        aliceManager = new GroupManager({
            storage,
            deviceIdentity: alice.device,
            rootKeyPair: alice.root.rootKeyPair,
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Group Creation
    // ═══════════════════════════════════════════════════════════════════════

    it('creates a group with a genesis entry', async () => {
        const result = await aliceManager.createGroup('Weekend Trip');

        expect(result.groupId).toBeTruthy();
        expect(result.genesisEntry.entryType).toBe('Genesis');
        expect(result.state.groupName).toBe('Weekend Trip');
        expect(result.state.members.size).toBe(1);

        // Alice is the creator
        const aliceMember = result.state.members.get(alice.root.rootKeyPair.publicKey);
        expect(aliceMember).toBeTruthy();
        expect(aliceMember!.isActive).toBe(true);
    });

    it('creates a group with a custom display name', async () => {
        const result = await aliceManager.createGroup('Trip', 'Alice W.');

        const aliceMember = result.state.members.get(alice.root.rootKeyPair.publicKey);
        expect(aliceMember!.displayName).toBe('Alice W.');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Invite Links
    // ═══════════════════════════════════════════════════════════════════════

    it('creates a valid invite link', async () => {
        const result = await aliceManager.createGroup('Trip');
        const link = aliceManager.createInviteLink(result.groupId);

        const parsed = aliceManager.parseInviteLink(link);
        expect(parsed.token.groupId).toBe(result.groupId);
        expect(parsed.token.inviterRootPubkey).toBe(alice.root.rootKeyPair.publicKey);
        expect(parsed.token.expiresAt).toBeGreaterThan(Date.now());
    });

    it('creates invite link with relay URL and group secret', async () => {
        const result = await aliceManager.createGroup('Trip');
        const link = aliceManager.createInviteLink(result.groupId, {
            relayUrl: 'wss://relay.example.com',
            groupSecret: 'deadbeef',
        });

        const parsed = aliceManager.parseInviteLink(link);
        expect(parsed.relayUrl).toBe('wss://relay.example.com');
        expect(parsed.groupSecret).toBe('deadbeef');
    });

    it('throws if no root key pair for invite creation', async () => {
        const noRootManager = new GroupManager({
            storage,
            deviceIdentity: alice.device,
        });

        // Need to create group with alice manager (who has root key)
        const result = await aliceManager.createGroup('Trip');

        expect(() => noRootManager.createInviteLink(result.groupId))
            .toThrow('Root key pair required');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Join Group
    // ═══════════════════════════════════════════════════════════════════════

    it('joins a group via invite link', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const link = aliceManager.createInviteLink(groupId);

        // Bob uses a separate manager with same storage (simulating sync)
        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });

        const joinResult = await bobManager.joinGroup(link, 'Bob');

        expect(joinResult.groupId).toBe(groupId);
        expect(joinResult.memberAddedEntry.entryType).toBe('MemberAdded');
        expect(joinResult.state.members.size).toBe(2);

        // Bob is now an active member
        const bobMember = joinResult.state.members.get(bob.root.rootKeyPair.publicKey);
        expect(bobMember).toBeTruthy();
        expect(bobMember!.isActive).toBe(true);
        expect(bobMember!.displayName).toBe('Bob');
    });

    it('rejects expired invite', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');

        // Create an invite that expires immediately
        const token = createInviteToken(groupId, alice.root.rootKeyPair, -1000);
        const link = serializeInviteLink({ token });

        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });

        await expect(bobManager.joinGroup(link)).rejects.toThrow('expired');
    });

    it('rejects invite with invalid signature', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');

        // Create a token and tamper with the signature
        const token = createInviteToken(groupId, alice.root.rootKeyPair);
        token.inviteSignature = 'deadbeef'.repeat(16) as Signature;
        const link = serializeInviteLink({ token });

        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });

        await expect(bobManager.joinGroup(link)).rejects.toThrow('signature');
    });

    it('rejects double join', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const link = aliceManager.createInviteLink(groupId);

        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });

        await bobManager.joinGroup(link, 'Bob');
        await expect(bobManager.joinGroup(link, 'Bob')).rejects.toThrow('Already a member');
    });

    it('rejects join with no synced entries', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const link = aliceManager.createInviteLink(groupId);

        // Bob has a separate storage (no entries synced)
        const bobStorage = new InMemoryStorageAdapter();
        const bobManager = new GroupManager({
            storage: bobStorage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });

        await expect(bobManager.joinGroup(link)).rejects.toThrow('Sync the group first');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Member Removal
    // ═══════════════════════════════════════════════════════════════════════

    it('creator removes a member', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const link = aliceManager.createInviteLink(groupId);

        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });
        await bobManager.joinGroup(link, 'Bob');

        // Alice (creator) removes Bob
        const entry = await aliceManager.removeMember(
            groupId,
            bob.root.rootKeyPair.publicKey,
            'No longer participating',
        );

        expect(entry.entryType).toBe('MemberRemoved');

        const state = await aliceManager.deriveGroupState(groupId);
        const bobMember = state.members.get(bob.root.rootKeyPair.publicKey);
        expect(bobMember!.isActive).toBe(false);
    });

    it('member removes themselves', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const link = aliceManager.createInviteLink(groupId);

        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });
        await bobManager.joinGroup(link, 'Bob');

        // Bob removes himself
        const entry = await bobManager.removeMember(
            groupId,
            bob.root.rootKeyPair.publicKey,
            'Leaving group',
        );

        expect(entry.entryType).toBe('MemberRemoved');
    });

    it('non-creator cannot remove another member', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const link = aliceManager.createInviteLink(groupId);

        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });
        await bobManager.joinGroup(link, 'Bob');

        // Bob tries to remove Alice — should fail
        await expect(
            bobManager.removeMember(groupId, alice.root.rootKeyPair.publicKey, 'Tried'),
        ).rejects.toThrow('insufficient permissions');
    });

    it('cannot remove non-member', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const fakeKey = generateKeyPair().publicKey;

        await expect(
            aliceManager.removeMember(groupId, fakeKey, 'Who?'),
        ).rejects.toThrow('not an active member');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Device Authorization & Revocation
    // ═══════════════════════════════════════════════════════════════════════

    it('authorizes a new device', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const newDevice = generateKeyPair();

        const entry = await aliceManager.authorizeDevice(groupId, newDevice.publicKey, 'iPad');

        expect(entry.entryType).toBe('DeviceAuthorized');

        const state = await aliceManager.deriveGroupState(groupId);
        const aliceMember = state.members.get(alice.root.rootKeyPair.publicKey);
        expect(aliceMember!.authorizedDevices.has(newDevice.publicKey)).toBe(true);
    });

    it('revokes a device', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const newDevice = generateKeyPair();

        await aliceManager.authorizeDevice(groupId, newDevice.publicKey, 'iPad');
        const entry = await aliceManager.revokeDevice(groupId, newDevice.publicKey, 'Lost device');

        expect(entry.entryType).toBe('DeviceRevoked');

        const state = await aliceManager.deriveGroupState(groupId);
        const aliceMember = state.members.get(alice.root.rootKeyPair.publicKey);
        expect(aliceMember!.authorizedDevices.has(newDevice.publicKey)).toBe(false);
    });

    it('cannot revoke a device that is not mine', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const fakeDevice = generateKeyPair().publicKey;

        await expect(
            aliceManager.revokeDevice(groupId, fakeDevice, 'Not mine'),
        ).rejects.toThrow('device not found');
    });

    it('throws if no root key pair for device authorization', async () => {
        const noRootManager = new GroupManager({
            storage,
            deviceIdentity: alice.device,
        });

        const { groupId } = await aliceManager.createGroup('Trip');
        const newDevice = generateKeyPair();

        await expect(
            noRootManager.authorizeDevice(groupId, newDevice.publicKey, 'iPad'),
        ).rejects.toThrow('Root key pair required');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // State Queries
    // ═══════════════════════════════════════════════════════════════════════

    it('lists groups', async () => {
        await aliceManager.createGroup('Trip 1');
        await aliceManager.createGroup('Trip 2');

        const groups = await aliceManager.listGroups();
        expect(groups.length).toBe(2);
    });

    it('getGroupState returns null for unknown group', async () => {
        const state = await aliceManager.getGroupState('nonexistent' as GroupId);
        expect(state).toBeNull();
    });

    it('deriveGroupState throws for unknown group', async () => {
        await expect(
            aliceManager.deriveGroupState('nonexistent' as GroupId),
        ).rejects.toThrow('No entries found');
    });
});
