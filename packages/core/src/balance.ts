// =============================================================================
// SplitLedger — Balance Computer
// =============================================================================
//
// Deterministic balance computation via ordered ledger replay.
// All amounts in minor currency units (integers) — no floating point.
//

import type {
    ExpenseCreatedPayload,
    GroupState,
    Hash,
    LedgerEntry,
    PublicKey,
} from './types.js';
import { EntryType } from './types.js';

// =============================================================================
// Effective Expense Resolution
// =============================================================================

/**
 * Resolve corrections: for each expense, find the latest correction (if any)
 * and use that as the effective expense data.
 *
 * Returns a map of original entry_id → effective ExpenseCreatedPayload.
 */
export function getEffectiveExpenses(
    entries: LedgerEntry[],
): Map<Hash, ExpenseCreatedPayload> {
    const effectiveExpenses = new Map<Hash, ExpenseCreatedPayload>();
    // Track the correction chain: corrected entry → original entry
    const correctionToOriginal = new Map<Hash, Hash>();

    for (const entry of entries) {
        if (entry.entryType === EntryType.ExpenseCreated) {
            effectiveExpenses.set(entry.entryId, entry.payload);
        } else if (entry.entryType === EntryType.ExpenseCorrection) {
            const { referencedEntryId, correctedExpense } = entry.payload;

            // Find the root original: follow the correction chain
            let originalId = referencedEntryId;
            while (correctionToOriginal.has(originalId)) {
                originalId = correctionToOriginal.get(originalId)!;
            }

            // Map this correction back to the original
            correctionToOriginal.set(entry.entryId, originalId);

            // Replace the effective expense data
            effectiveExpenses.set(originalId, correctedExpense);
        }
    }

    return effectiveExpenses;
}

// =============================================================================
// Balance Computation
// =============================================================================

/**
 * Compute net balances from a set of effective expenses.
 *
 * Positive balance = member is owed money (they paid more than their share).
 * Negative balance = member owes money (they consumed more than they paid).
 *
 * Invariant: sum of all balances === 0.
 */
export function computeBalances(entries: LedgerEntry[]): Map<PublicKey, number> {
    const balances = new Map<PublicKey, number>();

    const effectiveExpenses = getEffectiveExpenses(entries);

    for (const expense of effectiveExpenses.values()) {
        const payer = expense.paidByRootPubkey;

        // Payer paid the full amount → they are owed this amount
        const currentPayerBalance = balances.get(payer) ?? 0;
        balances.set(payer, currentPayerBalance + expense.amountMinorUnits);

        // Each split participant owes their share
        for (const [memberKey, share] of Object.entries(expense.splits)) {
            const pubkey = memberKey as PublicKey;
            const currentBalance = balances.get(pubkey) ?? 0;
            balances.set(pubkey, currentBalance - share);
        }
    }

    return balances;
}

/**
 * Apply balance updates from the ledger to a GroupState.
 * This is a convenience that wraps computeBalances with the full entry list.
 */
export function recomputeGroupBalances(
    entries: LedgerEntry[],
    state: GroupState,
): void {
    state.balances = computeBalances(entries);
}

// =============================================================================
// Settlement Computation
// =============================================================================

interface Settlement {
    from: PublicKey;
    to: PublicKey;
    amount: number;
}

/**
 * Compute a minimal set of settlements to zero out all balances.
 * Uses a greedy algorithm: pair the largest debtor with the largest creditor.
 */
export function computeSettlements(balances: Map<PublicKey, number>): Settlement[] {
    const settlements: Settlement[] = [];

    // Separate into debtors (negative balance = owes money) and creditors (positive = owed money)
    const debtors: { pubkey: PublicKey; amount: number }[] = [];
    const creditors: { pubkey: PublicKey; amount: number }[] = [];

    for (const [pubkey, balance] of balances) {
        if (balance < 0) {
            debtors.push({ pubkey, amount: -balance }); // make positive for easier math
        } else if (balance > 0) {
            creditors.push({ pubkey, amount: balance });
        }
    }

    // Sort descending by amount
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    let di = 0;
    let ci = 0;

    while (di < debtors.length && ci < creditors.length) {
        const debtor = debtors[di]!;
        const creditor = creditors[ci]!;

        const transferAmount = Math.min(debtor.amount, creditor.amount);
        if (transferAmount > 0) {
            settlements.push({
                from: debtor.pubkey,
                to: creditor.pubkey,
                amount: transferAmount,
            });
        }

        debtor.amount -= transferAmount;
        creditor.amount -= transferAmount;

        if (debtor.amount === 0) di++;
        if (creditor.amount === 0) ci++;
    }

    return settlements;
}
