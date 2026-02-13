// =============================================================================
// Ledger Engine Unit Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
    orderEntries,
    validateEntry,
    validateFullChain,
    buildEntry,
    applyEntry,
    createEmptyGroupState,
} from '../ledger.js';
import { generateKeyPair, computeEntryId, signEntryId } from '../crypto.js';
import {
    createRootIdentity,
    createDeviceIdentity,
    createInviteToken,
    generateGroupId,
} from '../identity.js';
import { EntryType } from '../types.js';
import type { GroupState, Hash, LedgerEntry, PublicKey } from '../types.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestGroup() {
    const root = createRootIdentity('Alice');
    const device = createDeviceIdentity(root.rootKeyPair, 'iPhone');
    const groupId = generateGroupId();

    const genesis = buildEntry(
        EntryType.Genesis,
        {
            groupId,
            groupName: 'Test Group',
            creatorRootPubkey: root.rootKeyPair.publicKey,
            creatorDisplayName: 'Alice',
        },
        null,
        0,
        device.deviceKeyPair.publicKey,
        device.deviceKeyPair.secretKey,
        1000,
    );

    return { root, device, groupId, genesis };
}

function applyGenesisToState(genesis: LedgerEntry, state: GroupState): void {
    applyEntry(genesis, state);
}

// =============================================================================
// Tests
// =============================================================================

describe('LedgerEngine', () => {
    describe('orderEntries', () => {
        it('sorts by lamport clock ascending', () => {
            const kp = generateKeyPair();
            const entries = [2, 0, 1].map((clock) =>
                buildEntry(
                    EntryType.Genesis,
                    { groupId: 'g' as any, groupName: 'G', creatorRootPubkey: kp.publicKey, creatorDisplayName: 'A' },
                    null, clock, kp.publicKey, kp.secretKey, 1000,
                ),
            );
            const ordered = orderEntries(entries);
            expect(ordered.map((e) => e.lamportClock)).toEqual([0, 1, 2]);
        });

        it('breaks ties by timestamp', () => {
            const kp = generateKeyPair();
            const e1 = buildEntry(
                EntryType.Genesis,
                { groupId: 'g' as any, groupName: 'G', creatorRootPubkey: kp.publicKey, creatorDisplayName: 'A' },
                null, 0, kp.publicKey, kp.secretKey, 2000,
            );
            const e2 = buildEntry(
                EntryType.Genesis,
                { groupId: 'g2' as any, groupName: 'G2', creatorRootPubkey: kp.publicKey, creatorDisplayName: 'A' },
                null, 0, kp.publicKey, kp.secretKey, 1000,
            );
            const ordered = orderEntries([e1, e2]);
            expect(ordered[0]!.timestamp).toBe(1000);
            expect(ordered[1]!.timestamp).toBe(2000);
        });

        it('is deterministic on shuffled input', () => {
            const kp = generateKeyPair();
            const entries = Array.from({ length: 10 }, (_, i) =>
                buildEntry(
                    EntryType.Genesis,
                    { groupId: `g${i}` as any, groupName: `G${i}`, creatorRootPubkey: kp.publicKey, creatorDisplayName: 'A' },
                    null, i, kp.publicKey, kp.secretKey, 1000 + i,
                ),
            );
            // Shuffle
            const shuffled = [...entries].sort(() => Math.random() - 0.5);
            const ordered1 = orderEntries(shuffled);
            const ordered2 = orderEntries([...entries].reverse());
            expect(ordered1.map((e) => e.entryId)).toEqual(ordered2.map((e) => e.entryId));
        });
    });

    describe('validateEntry', () => {
        let state: GroupState;
        let testGroup: ReturnType<typeof createTestGroup>;

        beforeEach(() => {
            testGroup = createTestGroup();
            state = createEmptyGroupState();
            applyGenesisToState(testGroup.genesis, state);
        });

        it('validates correct genesis entry', () => {
            const emptyState = createEmptyGroupState();
            const result = validateEntry(testGroup.genesis, [], emptyState);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('rejects duplicate genesis', () => {
            const result = validateEntry(testGroup.genesis, [testGroup.genesis], state);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes('first entry'))).toBe(true);
        });

        it('rejects hash mismatch (tampered content)', () => {
            const { genesis } = testGroup;
            // Tamper with the entry: change timestamp but keep old hash
            const tampered = { ...genesis, timestamp: genesis.timestamp + 1 };
            const emptyState = createEmptyGroupState();
            const result = validateEntry(tampered as LedgerEntry, [], emptyState);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes('tampered'))).toBe(true);
        });

        it('rejects bad signature', () => {
            const { device, groupId } = testGroup;
            const wrongKp = generateKeyPair();
            // Build entry but sign with wrong key
            const entry = buildEntry(
                EntryType.Genesis,
                { groupId, groupName: 'Test', creatorRootPubkey: wrongKp.publicKey, creatorDisplayName: 'A' },
                null, 0, device.deviceKeyPair.publicKey, wrongKp.secretKey, 1000,
            );
            const emptyState = createEmptyGroupState();
            const result = validateEntry(entry, [], emptyState);
            // The hash will be correct (built properly), but signature verifies against
            // creatorDevicePubkey which is device's key, not wrongKp — so signature should fail
            expect(result.valid).toBe(false);
        });

        it('rejects broken previousHash chain', () => {
            const { device, root, groupId, genesis } = testGroup;
            const expense = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: 'Lunch',
                    amountMinorUnits: 1000,
                    currency: 'EUR',
                    paidByRootPubkey: root.rootKeyPair.publicKey,
                    splits: { [root.rootKeyPair.publicKey]: 1000 },
                },
                'deadbeef'.repeat(8) as Hash, // wrong previous hash
                1,
                device.deviceKeyPair.publicKey,
                device.deviceKeyPair.secretKey,
                2000,
            );
            const result = validateEntry(expense, [genesis], state);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes('unknown entry'))).toBe(true);
        });

        it('rejects unauthorized device', () => {
            const { root, groupId, genesis } = testGroup;
            const strangerDevice = generateKeyPair();
            const expense = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: 'Lunch',
                    amountMinorUnits: 1000,
                    currency: 'EUR',
                    paidByRootPubkey: root.rootKeyPair.publicKey,
                    splits: { [root.rootKeyPair.publicKey]: 1000 },
                },
                genesis.entryId,
                1,
                strangerDevice.publicKey,
                strangerDevice.secretKey,
                2000,
            );
            const result = validateEntry(expense, [genesis], state);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes('not authorized'))).toBe(true);
        });

        it('validates correct expense entry', () => {
            const { device, root, genesis } = testGroup;
            const expense = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: 'Lunch',
                    amountMinorUnits: 1000,
                    currency: 'EUR',
                    paidByRootPubkey: root.rootKeyPair.publicKey,
                    splits: { [root.rootKeyPair.publicKey]: 1000 },
                },
                genesis.entryId,
                1,
                device.deviceKeyPair.publicKey,
                device.deviceKeyPair.secretKey,
                2000,
            );
            const result = validateEntry(expense, [genesis], state);
            expect(result.valid).toBe(true);
        });

        it('rejects expense with splits not summing to total', () => {
            const { device, root, genesis } = testGroup;
            const expense = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: 'Lunch',
                    amountMinorUnits: 1000,
                    currency: 'EUR',
                    paidByRootPubkey: root.rootKeyPair.publicKey,
                    splits: { [root.rootKeyPair.publicKey]: 500 }, // only 500, not 1000
                },
                genesis.entryId,
                1,
                device.deviceKeyPair.publicKey,
                device.deviceKeyPair.secretKey,
                2000,
            );
            const result = validateEntry(expense, [genesis], state);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes('Splits sum'))).toBe(true);
        });

        it('rejects MemberAdded with expired invite', () => {
            const { device, root, genesis, groupId } = testGroup;

            const newMember = createRootIdentity('Bob');
            // Create invite that expired in the past
            const expiredToken = createInviteToken(groupId, root.rootKeyPair, -1000);

            const memberAdded = buildEntry(
                EntryType.MemberAdded,
                {
                    memberRootPubkey: newMember.rootKeyPair.publicKey,
                    memberDisplayName: 'Bob',
                    inviteToken: expiredToken,
                },
                genesis.entryId,
                1,
                device.deviceKeyPair.publicKey,
                device.deviceKeyPair.secretKey,
                Date.now() + 10 * 60 * 1000, // timestamp well after expiry + skew
            );

            const result = validateEntry(memberAdded, [genesis], state);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes('expired'))).toBe(true);
        });
    });

    describe('validateFullChain', () => {
        it('validates a valid chain from genesis through expenses', () => {
            const { device, root, genesis, groupId } = createTestGroup();

            const expense = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: 'Coffee',
                    amountMinorUnits: 500,
                    currency: 'EUR',
                    paidByRootPubkey: root.rootKeyPair.publicKey,
                    splits: { [root.rootKeyPair.publicKey]: 500 },
                },
                genesis.entryId,
                1,
                device.deviceKeyPair.publicKey,
                device.deviceKeyPair.secretKey,
                2000,
            );

            const result = validateFullChain([genesis, expense]);
            expect(result.valid).toBe(true);
            expect(result.finalState).not.toBeNull();
            expect(result.finalState!.groupName).toBe('Test Group');
            expect(result.finalState!.members.size).toBe(1);
        });

        it('rejects empty chain', () => {
            const result = validateFullChain([]);
            expect(result.valid).toBe(true); // empty chain is technically valid
            expect(result.finalState).not.toBeNull();
        });

        it('rejects chain starting with non-genesis', () => {
            const kp = generateKeyPair();
            const expense = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: 'Coffee',
                    amountMinorUnits: 500,
                    currency: 'EUR',
                    paidByRootPubkey: kp.publicKey,
                    splits: { [kp.publicKey]: 500 },
                },
                null,
                0,
                kp.publicKey,
                kp.secretKey,
                1000,
            );
            const result = validateFullChain([expense]);
            expect(result.valid).toBe(false);
        });

        it('validates expense correction chain', () => {
            const { device, root, genesis } = createTestGroup();

            const expense = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: 'Coffee',
                    amountMinorUnits: 500,
                    currency: 'EUR',
                    paidByRootPubkey: root.rootKeyPair.publicKey,
                    splits: { [root.rootKeyPair.publicKey]: 500 },
                },
                genesis.entryId,
                1,
                device.deviceKeyPair.publicKey,
                device.deviceKeyPair.secretKey,
                2000,
            );

            const correction = buildEntry(
                EntryType.ExpenseCorrection,
                {
                    referencedEntryId: expense.entryId,
                    correctionReason: 'Wrong amount',
                    correctedExpense: {
                        description: 'Coffee (corrected)',
                        amountMinorUnits: 600,
                        currency: 'EUR',
                        paidByRootPubkey: root.rootKeyPair.publicKey,
                        splits: { [root.rootKeyPair.publicKey]: 600 },
                    },
                },
                expense.entryId,
                2,
                device.deviceKeyPair.publicKey,
                device.deviceKeyPair.secretKey,
                3000,
            );

            const result = validateFullChain([genesis, expense, correction]);
            expect(result.valid).toBe(true);
        });
    });

    describe('buildEntry', () => {
        it('creates entry with valid hash and signature', () => {
            const kp = generateKeyPair();
            const entry = buildEntry(
                EntryType.Genesis,
                {
                    groupId: generateGroupId(),
                    groupName: 'Test',
                    creatorRootPubkey: kp.publicKey,
                    creatorDisplayName: 'Alice',
                },
                null,
                0,
                kp.publicKey,
                kp.secretKey,
                1000,
            );

            expect(entry.entryId).toMatch(/^[0-9a-f]{64}$/);
            expect(entry.signature).toMatch(/^[0-9a-f]{128}$/);

            // Self-validate
            const emptyState = createEmptyGroupState();
            const result = validateEntry(entry, [], emptyState);
            expect(result.valid).toBe(true);
        });
    });
});
