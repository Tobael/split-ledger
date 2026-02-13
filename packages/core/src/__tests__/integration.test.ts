// =============================================================================
// Integration Test — End-to-End Local Flow
// =============================================================================
//
// Full lifecycle: identity → group → members → expenses → correction → balances
//

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorageAdapter } from '../storage.js';
import {
    createRootIdentity,
    createDeviceIdentity,
    createInviteToken,
    createDeviceAuthorization,
    generateGroupId,
} from '../identity.js';
import { buildEntry, validateFullChain, orderEntries } from '../ledger.js';
import { computeBalances, computeSettlements } from '../balance.js';
import { EntryType } from '../types.js';
import type { LedgerEntry, GroupId } from '../types.js';

describe('Integration: Full Local Flow', () => {
    let storage: InMemoryStorageAdapter;

    beforeEach(() => {
        storage = new InMemoryStorageAdapter();
    });

    it('complete lifecycle: create group, add member, expenses, correction, balances', async () => {
        // ─── Step 1: Create identities ───
        const alice = createRootIdentity('Alice');
        const aliceDevice = createDeviceIdentity(alice.rootKeyPair, "Alice's iPhone");
        await storage.storeRootIdentity(alice);
        await storage.storeDeviceIdentity(aliceDevice);

        const bob = createRootIdentity('Bob');
        const bobDevice = createDeviceIdentity(bob.rootKeyPair, "Bob's Android");

        // ─── Step 2: Create group (Genesis) ───
        const groupId = generateGroupId();
        const genesis = buildEntry(
            EntryType.Genesis,
            {
                groupId,
                groupName: 'Apartment 4B',
                creatorRootPubkey: alice.rootKeyPair.publicKey,
                creatorDisplayName: 'Alice',
            },
            null,
            0,
            aliceDevice.deviceKeyPair.publicKey,
            aliceDevice.deviceKeyPair.secretKey,
            1000,
        );
        await storage.appendEntry(groupId, genesis);

        // ─── Step 3: Add Bob via invite ───
        const invite = createInviteToken(groupId, alice.rootKeyPair);
        const memberAdded = buildEntry(
            EntryType.MemberAdded,
            {
                memberRootPubkey: bob.rootKeyPair.publicKey,
                memberDisplayName: 'Bob',
                inviteToken: invite,
            },
            genesis.entryId,
            1,
            aliceDevice.deviceKeyPair.publicKey,
            aliceDevice.deviceKeyPair.secretKey,
            2000,
        );
        await storage.appendEntry(groupId, memberAdded);

        // ─── Step 4: Authorize Bob's device ───
        const bobAuth = createDeviceAuthorization(
            bob.rootKeyPair,
            bobDevice.deviceKeyPair.publicKey,
            "Bob's Android",
            3000, // authorizedAt must match entry timestamp
        );

        const deviceAuth = buildEntry(
            EntryType.DeviceAuthorized,
            {
                ownerRootPubkey: bob.rootKeyPair.publicKey,
                devicePublicKey: bobDevice.deviceKeyPair.publicKey,
                deviceName: "Bob's Android",
                authorizationSignature: bobAuth.authorizationSignature,
            },
            memberAdded.entryId,
            2,
            aliceDevice.deviceKeyPair.publicKey,
            aliceDevice.deviceKeyPair.secretKey,
            3000,
        );
        await storage.appendEntry(groupId, deviceAuth);

        // ─── Step 5: Alice creates an expense ───
        const expense1 = buildEntry(
            EntryType.ExpenseCreated,
            {
                description: 'Groceries',
                amountMinorUnits: 5000, // €50.00
                currency: 'EUR',
                paidByRootPubkey: alice.rootKeyPair.publicKey,
                splits: {
                    [alice.rootKeyPair.publicKey]: 2500,
                    [bob.rootKeyPair.publicKey]: 2500,
                },
            },
            deviceAuth.entryId,
            3,
            aliceDevice.deviceKeyPair.publicKey,
            aliceDevice.deviceKeyPair.secretKey,
            4000,
        );
        await storage.appendEntry(groupId, expense1);

        // ─── Step 6: Bob creates an expense ───
        const expense2 = buildEntry(
            EntryType.ExpenseCreated,
            {
                description: 'Electric bill',
                amountMinorUnits: 8000, // €80.00
                currency: 'EUR',
                paidByRootPubkey: bob.rootKeyPair.publicKey,
                splits: {
                    [alice.rootKeyPair.publicKey]: 4000,
                    [bob.rootKeyPair.publicKey]: 4000,
                },
            },
            expense1.entryId,
            4,
            bobDevice.deviceKeyPair.publicKey,
            bobDevice.deviceKeyPair.secretKey,
            5000,
        );
        await storage.appendEntry(groupId, expense2);

        // ─── Step 7: Alice corrects the first expense ───
        const correction = buildEntry(
            EntryType.ExpenseCorrection,
            {
                referencedEntryId: expense1.entryId,
                correctionReason: 'Forgot items, actual was €60',
                correctedExpense: {
                    description: 'Groceries (corrected)',
                    amountMinorUnits: 6000, // €60.00
                    currency: 'EUR',
                    paidByRootPubkey: alice.rootKeyPair.publicKey,
                    splits: {
                        [alice.rootKeyPair.publicKey]: 3000,
                        [bob.rootKeyPair.publicKey]: 3000,
                    },
                },
            },
            expense2.entryId,
            5,
            aliceDevice.deviceKeyPair.publicKey,
            aliceDevice.deviceKeyPair.secretKey,
            6000,
        );
        await storage.appendEntry(groupId, correction);

        // ─── Step 8: Validate full chain ───
        const allEntries = await storage.getAllEntries(groupId);
        expect(allEntries).toHaveLength(6);

        const validationResult = validateFullChain(allEntries);
        expect(validationResult.valid).toBe(true);
        expect(validationResult.errors).toHaveLength(0);
        expect(validationResult.finalState).not.toBeNull();

        const finalState = validationResult.finalState!;
        expect(finalState.groupName).toBe('Apartment 4B');
        expect(finalState.members.size).toBe(2);

        // ─── Step 9: Compute balances ───
        const balances = computeBalances(orderEntries(allEntries));

        // After correction:
        //   Expense 1 (corrected): Alice paid €60, split 30/30 → Alice +30, Bob -30
        //   Expense 2: Bob paid €80, split 40/40 → Bob +40, Alice -40
        //   Net: Alice = +30 - 40 = -10, Bob = -30 + 40 = +10
        const aliceBalance = balances.get(alice.rootKeyPair.publicKey) ?? 0;
        const bobBalance = balances.get(bob.rootKeyPair.publicKey) ?? 0;

        expect(aliceBalance).toBe(-1000); // Alice owes €10
        expect(bobBalance).toBe(1000);    // Bob is owed €10

        // Verify zero-sum
        expect(aliceBalance + bobBalance).toBe(0);

        // ─── Step 10: Compute settlements ───
        const settlements = computeSettlements(balances);
        expect(settlements).toHaveLength(1);
        expect(settlements[0]).toEqual({
            from: alice.rootKeyPair.publicKey,
            to: bob.rootKeyPair.publicKey,
            amount: 1000,
        });

        // ─── Step 11: Verify storage deduplication ───
        await storage.appendEntry(groupId, genesis); // duplicate
        const entriesAfterDupe = await storage.getAllEntries(groupId);
        expect(entriesAfterDupe).toHaveLength(6); // unchanged

        // ─── Step 12: Verify storage queries ───
        const latest = await storage.getLatestEntry(groupId);
        expect(latest!.entryId).toBe(correction.entryId);

        const entriesAfterClock3 = await storage.getEntriesAfter(groupId, 3);
        expect(entriesAfterClock3).toHaveLength(2); // clock 4 (expense2) + clock 5 (correction)

        const retrieved = await storage.getEntry(expense1.entryId);
        expect(retrieved!.entryId).toBe(expense1.entryId);
    });

    it('rejects tampered chain during full validation', async () => {
        const alice = createRootIdentity('Alice');
        const device = createDeviceIdentity(alice.rootKeyPair, 'iPhone');
        const groupId = generateGroupId();

        const genesis = buildEntry(
            EntryType.Genesis,
            {
                groupId,
                groupName: 'Test',
                creatorRootPubkey: alice.rootKeyPair.publicKey,
                creatorDisplayName: 'Alice',
            },
            null, 0,
            device.deviceKeyPair.publicKey,
            device.deviceKeyPair.secretKey,
            1000,
        );

        // Tamper with genesis after building
        const tampered = { ...genesis, timestamp: 9999 } as LedgerEntry;

        const result = validateFullChain([tampered]);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles multiple groups independently', async () => {
        const alice = createRootIdentity('Alice');
        const device = createDeviceIdentity(alice.rootKeyPair, 'iPhone');

        const group1 = generateGroupId();
        const group2 = generateGroupId();

        const genesis1 = buildEntry(
            EntryType.Genesis,
            {
                groupId: group1,
                groupName: 'Group 1',
                creatorRootPubkey: alice.rootKeyPair.publicKey,
                creatorDisplayName: 'Alice',
            },
            null, 0, device.deviceKeyPair.publicKey, device.deviceKeyPair.secretKey, 1000,
        );
        const genesis2 = buildEntry(
            EntryType.Genesis,
            {
                groupId: group2,
                groupName: 'Group 2',
                creatorRootPubkey: alice.rootKeyPair.publicKey,
                creatorDisplayName: 'Alice',
            },
            null, 0, device.deviceKeyPair.publicKey, device.deviceKeyPair.secretKey, 1000,
        );

        await storage.appendEntry(group1, genesis1);
        await storage.appendEntry(group2, genesis2);

        const groups = await storage.getGroupIds();
        expect(groups).toHaveLength(2);

        const entries1 = await storage.getAllEntries(group1);
        const entries2 = await storage.getAllEntries(group2);
        expect(entries1).toHaveLength(1);
        expect(entries2).toHaveLength(1);
        expect(entries1[0]!.entryId).not.toBe(entries2[0]!.entryId);
    });
});
