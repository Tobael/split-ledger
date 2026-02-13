// =============================================================================
// Balance Computer Unit Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { computeBalances, computeSettlements, getEffectiveExpenses } from '../balance.js';
import { buildEntry } from '../ledger.js';
import { generateKeyPair } from '../crypto.js';
import { generateGroupId } from '../identity.js';
import { EntryType } from '../types.js';
import type { Hash, LedgerEntry, PublicKey } from '../types.js';

// =============================================================================
// Helpers
// =============================================================================

function makeGenesis(kp: { publicKey: PublicKey; secretKey: string }) {
    return buildEntry(
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
        kp.secretKey as any,
        1000,
    );
}

function makeExpense(
    kp: { publicKey: PublicKey; secretKey: string },
    prevHash: Hash,
    clock: number,
    amount: number,
    paidBy: PublicKey,
    splits: Record<string, number>,
) {
    return buildEntry(
        EntryType.ExpenseCreated,
        {
            description: 'Test expense',
            amountMinorUnits: amount,
            currency: 'EUR',
            paidByRootPubkey: paidBy,
            splits,
        },
        prevHash,
        clock,
        kp.publicKey,
        kp.secretKey as any,
        1000 + clock,
    );
}

function makeCorrection(
    kp: { publicKey: PublicKey; secretKey: string },
    prevHash: Hash,
    clock: number,
    referencedId: Hash,
    correctedAmount: number,
    paidBy: PublicKey,
    splits: Record<string, number>,
) {
    return buildEntry(
        EntryType.ExpenseCorrection,
        {
            referencedEntryId: referencedId,
            correctionReason: 'Correction',
            correctedExpense: {
                description: 'Corrected expense',
                amountMinorUnits: correctedAmount,
                currency: 'EUR',
                paidByRootPubkey: paidBy,
                splits,
            },
        },
        prevHash,
        clock,
        kp.publicKey,
        kp.secretKey as any,
        1000 + clock,
    );
}

// =============================================================================
// Tests
// =============================================================================

describe('BalanceComputer', () => {
    describe('computeBalances', () => {
        it('handles simple 2-person 50/50 split', () => {
            const alice = generateKeyPair();
            const bob = generateKeyPair();
            const genesis = makeGenesis(alice);
            const expense = makeExpense(alice, genesis.entryId, 1, 1000, alice.publicKey, {
                [alice.publicKey]: 500,
                [bob.publicKey]: 500,
            });

            const balances = computeBalances([genesis, expense]);
            // Alice paid 1000, her share is 500, so she's owed 500
            expect(balances.get(alice.publicKey)).toBe(500);
            // Bob's share is 500, he paid nothing, so he owes 500
            expect(balances.get(bob.publicKey)).toBe(-500);
        });

        it('handles multi-way unequal split', () => {
            const alice = generateKeyPair();
            const bob = generateKeyPair();
            const carol = generateKeyPair();
            const genesis = makeGenesis(alice);
            const expense = makeExpense(alice, genesis.entryId, 1, 3000, alice.publicKey, {
                [alice.publicKey]: 1000,
                [bob.publicKey]: 1200,
                [carol.publicKey]: 800,
            });

            const balances = computeBalances([genesis, expense]);
            // Alice paid 3000, her share is 1000 → net +2000
            expect(balances.get(alice.publicKey)).toBe(2000);
            // Bob: share 1200, paid 0 → net -1200
            expect(balances.get(bob.publicKey)).toBe(-1200);
            // Carol: share 800, paid 0 → net -800
            expect(balances.get(carol.publicKey)).toBe(-800);
        });

        it('balances always sum to zero', () => {
            const alice = generateKeyPair();
            const bob = generateKeyPair();
            const genesis = makeGenesis(alice);
            const e1 = makeExpense(alice, genesis.entryId, 1, 1500, alice.publicKey, {
                [alice.publicKey]: 750,
                [bob.publicKey]: 750,
            });
            const e2 = makeExpense(alice, e1.entryId, 2, 2000, bob.publicKey, {
                [alice.publicKey]: 800,
                [bob.publicKey]: 1200,
            });

            const balances = computeBalances([genesis, e1, e2]);
            const sum = Array.from(balances.values()).reduce((a, b) => a + b, 0);
            expect(sum).toBe(0);
        });

        it('handles no expenses', () => {
            const alice = generateKeyPair();
            const genesis = makeGenesis(alice);
            const balances = computeBalances([genesis]);
            expect(balances.size).toBe(0);
        });
    });

    describe('getEffectiveExpenses', () => {
        it('correction overrides original', () => {
            const alice = generateKeyPair();
            const genesis = makeGenesis(alice);
            const expense = makeExpense(alice, genesis.entryId, 1, 1000, alice.publicKey, {
                [alice.publicKey]: 1000,
            });
            const correction = makeCorrection(
                alice,
                expense.entryId,
                2,
                expense.entryId,
                2000,
                alice.publicKey,
                { [alice.publicKey]: 2000 },
            );

            const effective = getEffectiveExpenses([genesis, expense, correction]);
            // The original expense ID should now have the corrected data
            expect(effective.get(expense.entryId)!.amountMinorUnits).toBe(2000);
            expect(effective.size).toBe(1); // only one effective expense
        });

        it('balance reflects correction, not original', () => {
            const alice = generateKeyPair();
            const bob = generateKeyPair();
            const genesis = makeGenesis(alice);
            const expense = makeExpense(alice, genesis.entryId, 1, 1000, alice.publicKey, {
                [alice.publicKey]: 500,
                [bob.publicKey]: 500,
            });
            const correction = makeCorrection(
                alice,
                expense.entryId,
                2,
                expense.entryId,
                2000,
                alice.publicKey,
                { [alice.publicKey]: 1000, [bob.publicKey]: 1000 },
            );

            const balances = computeBalances([genesis, expense, correction]);
            // With correction: Alice paid 2000, share 1000 → net +1000
            expect(balances.get(alice.publicKey)).toBe(1000);
            expect(balances.get(bob.publicKey)).toBe(-1000);
        });
    });

    describe('computeSettlements', () => {
        it('computes minimal transfers for 2 people', () => {
            const alice = 'alice' as PublicKey;
            const bob = 'bob' as PublicKey;
            const balances = new Map<PublicKey, number>([
                [alice, 500],  // owed 500
                [bob, -500],   // owes 500
            ]);

            const settlements = computeSettlements(balances);
            expect(settlements).toHaveLength(1);
            expect(settlements[0]).toEqual({ from: bob, to: alice, amount: 500 });
        });

        it('computes minimal transfers for 3 people', () => {
            const alice = 'alice' as PublicKey;
            const bob = 'bob' as PublicKey;
            const carol = 'carol' as PublicKey;
            const balances = new Map<PublicKey, number>([
                [alice, 2000],   // owed 2000
                [bob, -1200],    // owes 1200
                [carol, -800],   // owes 800
            ]);

            const settlements = computeSettlements(balances);
            // Expect 2 transfers (optimal for 3 people with these amounts)
            expect(settlements).toHaveLength(2);
            // Total transferred should equal the total debt
            const totalTransferred = settlements.reduce((sum, s) => sum + s.amount, 0);
            expect(totalTransferred).toBe(2000);
        });

        it('handles already balanced', () => {
            const alice = 'alice' as PublicKey;
            const balances = new Map<PublicKey, number>([[alice, 0]]);
            expect(computeSettlements(balances)).toHaveLength(0);
        });

        it('handles empty balances', () => {
            expect(computeSettlements(new Map())).toHaveLength(0);
        });
    });
});
