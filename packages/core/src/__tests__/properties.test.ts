// =============================================================================
// Property-Based Tests (fast-check)
// =============================================================================

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { orderEntries, buildEntry } from '../ledger.js';
import { computeBalances } from '../balance.js';
import { generateKeyPair, hash, computeEntryId } from '../crypto.js';
import { generateGroupId } from '../identity.js';
import { EntryType } from '../types.js';
import type { LedgerEntry, PublicKey, Hash } from '../types.js';

// =============================================================================
// Arbitraries
// =============================================================================

const memberKp = () => generateKeyPair();

function arbitraryExpenseEntry(
    kp: { publicKey: PublicKey; secretKey: string },
    members: PublicKey[],
    prevHash: Hash,
    clock: number,
): fc.Arbitrary<LedgerEntry> {
    return fc.record({
        amount: fc.integer({ min: 1, max: 100000 }),
        payerIdx: fc.integer({ min: 0, max: members.length - 1 }),
    }).map(({ amount, payerIdx }) => {
        // Create equal split among all members
        const perMember = Math.floor(amount / members.length);
        const remainder = amount - perMember * members.length;
        const splits: Record<string, number> = {};
        members.forEach((m, i) => {
            splits[m] = perMember + (i === 0 ? remainder : 0);
        });

        return buildEntry(
            EntryType.ExpenseCreated,
            {
                description: 'Test',
                amountMinorUnits: amount,
                currency: 'EUR',
                paidByRootPubkey: members[payerIdx]!,
                splits,
            },
            prevHash,
            clock,
            kp.publicKey,
            kp.secretKey as any,
            1000 + clock,
        );
    });
}

// =============================================================================
// Properties
// =============================================================================

describe('Property-Based Tests', () => {
    describe('Balance Conservation', () => {
        it('sum of all balances is always zero', () => {
            const kp = memberKp();
            const members = [kp.publicKey];
            const genesis = buildEntry(
                EntryType.Genesis,
                {
                    groupId: generateGroupId(),
                    groupName: 'Test',
                    creatorRootPubkey: kp.publicKey,
                    creatorDisplayName: 'Alice',
                },
                null, 0, kp.publicKey, kp.secretKey as any, 1000,
            );

            fc.assert(
                fc.property(
                    fc.array(fc.integer({ min: 1, max: 100000 }), { minLength: 1, maxLength: 50 }),
                    (amounts) => {
                        const entries: LedgerEntry[] = [genesis];
                        let prevHash = genesis.entryId;

                        for (let i = 0; i < amounts.length; i++) {
                            const amount = amounts[i]!;
                            const expense = buildEntry(
                                EntryType.ExpenseCreated,
                                {
                                    description: `Expense ${i}`,
                                    amountMinorUnits: amount,
                                    currency: 'EUR',
                                    paidByRootPubkey: kp.publicKey,
                                    splits: { [kp.publicKey]: amount },
                                },
                                prevHash,
                                i + 1,
                                kp.publicKey,
                                kp.secretKey as any,
                                1000 + i + 1,
                            );
                            entries.push(expense);
                            prevHash = expense.entryId;
                        }

                        const balances = computeBalances(entries);
                        const sum = Array.from(balances.values()).reduce((a, b) => a + b, 0);
                        return sum === 0;
                    },
                ),
                { numRuns: 100 },
            );
        });

        it('multi-member balance conservation', () => {
            const alice = memberKp();
            const bob = memberKp();
            const genesis = buildEntry(
                EntryType.Genesis,
                {
                    groupId: generateGroupId(),
                    groupName: 'Test',
                    creatorRootPubkey: alice.publicKey,
                    creatorDisplayName: 'Alice',
                },
                null, 0, alice.publicKey, alice.secretKey as any, 1000,
            );

            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            amount: fc.integer({ min: 2, max: 100000 }),
                            alicePays: fc.boolean(),
                        }),
                        { minLength: 1, maxLength: 30 },
                    ),
                    (expenses) => {
                        const entries: LedgerEntry[] = [genesis];
                        let prevHash = genesis.entryId;

                        for (let i = 0; i < expenses.length; i++) {
                            const { amount, alicePays } = expenses[i]!;
                            const payer = alicePays ? alice : bob;
                            const aliceShare = Math.floor(amount / 2);
                            const bobShare = amount - aliceShare;

                            const expense = buildEntry(
                                EntryType.ExpenseCreated,
                                {
                                    description: `Expense ${i}`,
                                    amountMinorUnits: amount,
                                    currency: 'EUR',
                                    paidByRootPubkey: payer.publicKey,
                                    splits: {
                                        [alice.publicKey]: aliceShare,
                                        [bob.publicKey]: bobShare,
                                    },
                                },
                                prevHash,
                                i + 1,
                                alice.publicKey,
                                alice.secretKey as any,
                                1000 + i + 1,
                            );
                            entries.push(expense);
                            prevHash = expense.entryId;
                        }

                        const balances = computeBalances(entries);
                        const sum = Array.from(balances.values()).reduce((a, b) => a + b, 0);
                        return sum === 0;
                    },
                ),
                { numRuns: 100 },
            );
        });
    });

    describe('Ordering Determinism', () => {
        it('any permutation of entries sorts to the same order', () => {
            const kp = memberKp();

            fc.assert(
                fc.property(
                    fc.integer({ min: 2, max: 20 }),
                    (count) => {
                        const entries: LedgerEntry[] = [];
                        for (let i = 0; i < count; i++) {
                            entries.push(
                                buildEntry(
                                    EntryType.Genesis,
                                    {
                                        groupId: generateGroupId(),
                                        groupName: `G${i}`,
                                        creatorRootPubkey: kp.publicKey,
                                        creatorDisplayName: 'A',
                                    },
                                    null, i, kp.publicKey, kp.secretKey as any, 1000 + i,
                                ),
                            );
                        }

                        // Shuffle with Fisher-Yates
                        const shuffled = [...entries];
                        for (let i = shuffled.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
                        }

                        const ordered1 = orderEntries(entries);
                        const ordered2 = orderEntries(shuffled);

                        return ordered1.every((e, idx) => e.entryId === ordered2[idx]!.entryId);
                    },
                ),
                { numRuns: 50 },
            );
        });
    });

    describe('Hash Integrity', () => {
        it('any field mutation causes hash mismatch', () => {
            const kp = memberKp();

            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100000 }),
                    fc.integer({ min: 1, max: 10 }),
                    (amount, clockDelta) => {
                        const entry = buildEntry(
                            EntryType.ExpenseCreated,
                            {
                                description: 'Test',
                                amountMinorUnits: amount,
                                currency: 'EUR',
                                paidByRootPubkey: kp.publicKey,
                                splits: { [kp.publicKey]: amount },
                            },
                            null,
                            0,
                            kp.publicKey,
                            kp.secretKey as any,
                            1000,
                        );

                        // Tamper: change lamport clock
                        const tampered = { ...entry, lamportClock: entry.lamportClock + clockDelta };
                        const recomputedId = computeEntryId({
                            previousHash: tampered.previousHash,
                            lamportClock: tampered.lamportClock,
                            timestamp: tampered.timestamp,
                            entryType: tampered.entryType,
                            payload: tampered.payload,
                            creatorDevicePubkey: tampered.creatorDevicePubkey,
                        });

                        return recomputedId !== entry.entryId;
                    },
                ),
                { numRuns: 100 },
            );
        });
    });
});
