import type { PublicKey } from "./types.js";

export interface Settlement {
    from: PublicKey;
    to: PublicKey;
    amount: number;
}

export function computeSettlements(balances: Map<PublicKey, number>): Settlement[] {
    const debtors = [...balances.entries()]
        .filter(([, balance]) => balance < 0)
        .map(([key, balance]) => ({ key, amount: -balance }))
        .sort((a, b) => a.key.localeCompare(b.key));
    const creditors = [...balances.entries()]
        .filter(([, balance]) => balance > 0)
        .map(([key, balance]) => ({ key, amount: balance }))
        .sort((a, b) => a.key.localeCompare(b.key));
    const settlements: Settlement[] = [];
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
        const debtor = debtors[debtorIndex]!;
        const creditor = creditors[creditorIndex]!;
        const amount = Math.min(debtor.amount, creditor.amount);
        if (amount > 0) settlements.push({ from: debtor.key, to: creditor.key, amount });
        debtor.amount -= amount;
        creditor.amount -= amount;
        if (debtor.amount === 0) debtorIndex += 1;
        if (creditor.amount === 0) creditorIndex += 1;
    }
    return settlements;
}
