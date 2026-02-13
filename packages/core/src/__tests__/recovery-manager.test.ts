// =============================================================================
// RecoveryManager — Unit Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { RecoveryManager } from '../recovery-manager.js';
import { GroupManager } from '../group-manager.js';
import { InMemoryStorageAdapter } from '../storage.js';
import { createRootIdentity, createDeviceIdentity, createInviteToken } from '../identity.js';
import { generateKeyPair } from '../crypto.js';
import type { PublicKey, Signature, CoSignature } from '../types.js';

// ─── Test Helpers ───

function createTestUser(name: string) {
    const root = createRootIdentity(name);
    const device = createDeviceIdentity(root.rootKeyPair, `${name}'s device`);
    return { root, device };
}

describe('RecoveryManager', () => {
    let storage: InMemoryStorageAdapter;
    let alice: ReturnType<typeof createTestUser>;
    let bob: ReturnType<typeof createTestUser>;
    let carol: ReturnType<typeof createTestUser>;
    let aliceManager: GroupManager;

    beforeEach(() => {
        storage = new InMemoryStorageAdapter();
        alice = createTestUser('Alice');
        bob = createTestUser('Bob');
        carol = createTestUser('Carol');
        aliceManager = new GroupManager({
            storage,
            deviceIdentity: alice.device,
            rootKeyPair: alice.root.rootKeyPair,
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Helpers to set up multi-member groups
    // ═══════════════════════════════════════════════════════════════════════

    async function setupThreeMemberGroup() {
        const { groupId } = await aliceManager.createGroup('Trip');

        // Add Bob
        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });
        const link1 = aliceManager.createInviteLink(groupId);
        await bobManager.joinGroup(link1, 'Bob');

        // Add Carol
        const carolManager = new GroupManager({
            storage,
            deviceIdentity: carol.device,
            rootKeyPair: carol.root.rootKeyPair,
        });
        const link2 = aliceManager.createInviteLink(groupId);
        await carolManager.joinGroup(link2, 'Carol');

        return { groupId, bobManager, carolManager };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Initiate Recovery
    // ═══════════════════════════════════════════════════════════════════════

    it('initiates recovery with a new key pair', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');

        const request = aliceManager.initiateRecovery(groupId);

        expect(request.groupId).toBe(groupId);
        expect(request.previousRootPubkey).toBe(alice.root.rootKeyPair.publicKey);
        expect(request.newRootPubkey).toBeTruthy();
        expect(request.newRootKeyPair).toBeTruthy();
        expect(request.newRootPubkey).not.toBe(request.previousRootPubkey);
        expect(request.createdAt).toBeGreaterThan(0);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Co-Signing
    // ═══════════════════════════════════════════════════════════════════════

    it('creates a valid co-signature', async () => {
        const { groupId, bobManager } = await setupThreeMemberGroup();
        const request = aliceManager.initiateRecovery(groupId);

        const coSig = bobManager.contributeRecoverySignature(request);

        expect(coSig.signerRootPubkey).toBe(bob.root.rootKeyPair.publicKey);
        expect(coSig.signature).toBeTruthy();
    });

    it('throws if no root key pair for co-signing', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');
        const request = aliceManager.initiateRecovery(groupId);

        const noRootManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
        });

        expect(() => noRootManager.contributeRecoverySignature(request))
            .toThrow('Root key pair required');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Recovery Threshold
    // ═══════════════════════════════════════════════════════════════════════

    it('computes threshold for 2-member group', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');

        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });
        const link = aliceManager.createInviteLink(groupId);
        await bobManager.joinGroup(link, 'Bob');

        // 2 members, recovering 1 → 1 other member → floor(1/2) + 1 = 1
        const threshold = await aliceManager.getRecoveryThreshold(
            groupId,
            alice.root.rootKeyPair.publicKey,
        );
        expect(threshold).toBe(1);
    });

    it('computes threshold for 3-member group', async () => {
        const { groupId } = await setupThreeMemberGroup();

        // 3 members, recovering 1 → 2 others → floor(2/2) + 1 = 2
        const threshold = await aliceManager.getRecoveryThreshold(
            groupId,
            alice.root.rootKeyPair.publicKey,
        );
        expect(threshold).toBe(2);
    });

    it('computes threshold for 5-member group', async () => {
        const { groupId } = await setupThreeMemberGroup();

        // Add dave and eve
        const dave = createTestUser('Dave');
        const eve = createTestUser('Eve');
        const daveManager = new GroupManager({
            storage, deviceIdentity: dave.device, rootKeyPair: dave.root.rootKeyPair,
        });
        const eveManager = new GroupManager({
            storage, deviceIdentity: eve.device, rootKeyPair: eve.root.rootKeyPair,
        });
        await daveManager.joinGroup(aliceManager.createInviteLink(groupId), 'Dave');
        await eveManager.joinGroup(aliceManager.createInviteLink(groupId), 'Eve');

        // 5 members, recovering 1 → 4 others → floor(4/2) + 1 = 3
        const threshold = await aliceManager.getRecoveryThreshold(
            groupId,
            alice.root.rootKeyPair.publicKey,
        );
        expect(threshold).toBe(3);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Complete Recovery
    // ═══════════════════════════════════════════════════════════════════════

    it('completes recovery with sufficient co-signatures (3-member group)', async () => {
        const { groupId, bobManager, carolManager } = await setupThreeMemberGroup();

        const request = aliceManager.initiateRecovery(groupId);

        // Threshold is 2 for a 3-member group
        const bobSig = bobManager.contributeRecoverySignature(request);
        const carolSig = carolManager.contributeRecoverySignature(request);

        const entry = await aliceManager.completeRecovery(request, [bobSig, carolSig]);

        expect(entry.entryType).toBe('RootKeyRotation');

        // Verify state after rotation
        const state = await aliceManager.deriveGroupState(groupId);

        // Old key should be deactivated
        const oldMember = state.members.get(alice.root.rootKeyPair.publicKey);
        expect(oldMember!.isActive).toBe(false);

        // New key should be active
        const newMember = state.members.get(request.newRootPubkey);
        expect(newMember).toBeTruthy();
        expect(newMember!.isActive).toBe(true);
    });

    it('rejects recovery with insufficient co-signatures', async () => {
        const { groupId, bobManager } = await setupThreeMemberGroup();

        const request = aliceManager.initiateRecovery(groupId);

        // Only 1 signature, but threshold is 2
        const bobSig = bobManager.contributeRecoverySignature(request);

        await expect(
            aliceManager.completeRecovery(request, [bobSig]),
        ).rejects.toThrow('Insufficient co-signatures: got 1, need 2');
    });

    it('filters out self co-signatures', async () => {
        const { groupId, bobManager } = await setupThreeMemberGroup();

        const request = aliceManager.initiateRecovery(groupId);

        // Alice tries to co-sign her own recovery
        const aliceSelfSig = aliceManager.contributeRecoverySignature(request);
        const bobSig = bobManager.contributeRecoverySignature(request);

        // Should fail: alice's self-sig is filtered, only 1 valid
        await expect(
            aliceManager.completeRecovery(request, [aliceSelfSig, bobSig]),
        ).rejects.toThrow('Insufficient co-signatures: got 1, need 2');
    });

    it('filters out duplicate co-signatures', async () => {
        const { groupId, bobManager } = await setupThreeMemberGroup();

        const request = aliceManager.initiateRecovery(groupId);

        const bobSig = bobManager.contributeRecoverySignature(request);

        // Bob signs twice — should only count once
        await expect(
            aliceManager.completeRecovery(request, [bobSig, bobSig]),
        ).rejects.toThrow('Insufficient co-signatures: got 1, need 2');
    });

    it('filters out invalid co-signatures', async () => {
        const { groupId, bobManager } = await setupThreeMemberGroup();

        const request = aliceManager.initiateRecovery(groupId);

        const bobSig = bobManager.contributeRecoverySignature(request);
        const tamperedSig: CoSignature = {
            signerRootPubkey: carol.root.rootKeyPair.publicKey,
            signature: 'deadbeef'.repeat(16) as Signature,
        };

        // Only Bob's valid, Carol's tampered — insufficient
        await expect(
            aliceManager.completeRecovery(request, [bobSig, tamperedSig]),
        ).rejects.toThrow('Insufficient co-signatures: got 1, need 2');
    });

    it('filters out co-signatures from non-members', async () => {
        const { groupId, bobManager } = await setupThreeMemberGroup();

        const request = aliceManager.initiateRecovery(groupId);

        const bobSig = bobManager.contributeRecoverySignature(request);

        // Outsider tries to co-sign
        const outsider = createTestUser('Outsider');
        const outsiderManager = new GroupManager({
            storage,
            deviceIdentity: outsider.device,
            rootKeyPair: outsider.root.rootKeyPair,
        });
        const outsiderSig = outsiderManager.contributeRecoverySignature(request);

        await expect(
            aliceManager.completeRecovery(request, [bobSig, outsiderSig]),
        ).rejects.toThrow('Insufficient co-signatures: got 1, need 2');
    });

    it('updates creator reference when creator recovers', async () => {
        const { groupId, bobManager, carolManager } = await setupThreeMemberGroup();

        const request = aliceManager.initiateRecovery(groupId);
        const bobSig = bobManager.contributeRecoverySignature(request);
        const carolSig = carolManager.contributeRecoverySignature(request);

        await aliceManager.completeRecovery(request, [bobSig, carolSig]);

        const state = await aliceManager.deriveGroupState(groupId);
        expect(state.creatorRootPubkey).toBe(request.newRootPubkey);
    });

    it('new root key starts with no authorized devices', async () => {
        const { groupId, bobManager, carolManager } = await setupThreeMemberGroup();

        const request = aliceManager.initiateRecovery(groupId);
        const bobSig = bobManager.contributeRecoverySignature(request);
        const carolSig = carolManager.contributeRecoverySignature(request);

        await aliceManager.completeRecovery(request, [bobSig, carolSig]);

        const state = await aliceManager.deriveGroupState(groupId);
        const newMember = state.members.get(request.newRootPubkey);
        // Per applyRootKeyRotation: new root key must re-authorize devices
        expect(newMember!.authorizedDevices.size).toBe(0);
    });

    it('completes recovery in 2-member group (threshold = 1)', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');

        const bobManager = new GroupManager({
            storage,
            deviceIdentity: bob.device,
            rootKeyPair: bob.root.rootKeyPair,
        });
        const link = aliceManager.createInviteLink(groupId);
        await bobManager.joinGroup(link, 'Bob');

        const request = aliceManager.initiateRecovery(groupId);
        const bobSig = bobManager.contributeRecoverySignature(request);

        const entry = await aliceManager.completeRecovery(request, [bobSig]);
        expect(entry.entryType).toBe('RootKeyRotation');
    });

    it('rejects recovery for non-member', async () => {
        const { groupId } = await aliceManager.createGroup('Trip');

        const recoveryManager = new RecoveryManager({
            storage,
            deviceIdentity: alice.device,
        });

        const request = recoveryManager.initiateRecovery(groupId, 'nonexistent' as PublicKey);

        await expect(
            recoveryManager.completeRecovery(request, []),
        ).rejects.toThrow('not an active member');
    });
});
