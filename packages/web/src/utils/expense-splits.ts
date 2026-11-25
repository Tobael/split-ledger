export function equalParticipantSplits(
    participantIds: readonly string[],
    amountMinorUnits: number,
    excluded: ReadonlySet<string> = new Set(),
): Record<string, number> {
    const eligible = participantIds.filter((participantId) => !excluded.has(participantId));
    if (eligible.length === 0) throw new Error('At least one participant must be included');
    const base = Math.floor(amountMinorUnits / eligible.length);
    const remainder = amountMinorUnits - base * eligible.length;
    const eligibleIndex = new Map(eligible.map((participantId, index) => [participantId, index]));
    return Object.fromEntries(participantIds.map((participantId) => {
        const index = eligibleIndex.get(participantId);
        return [participantId, index === undefined ? 0 : base + (index < remainder ? 1 : 0)];
    }));
}

export function amountToMinorUnits(value: string): number {
    if (!/^\d*(?:\.\d{0,2})?$/.test(value)) return NaN;
    const [whole, fraction = ''] = value.split('.');
    const minor = Number(whole + fraction.padEnd(2, '0'));
    return Number.isSafeInteger(minor) ? minor : NaN;
}

export function rebalanceCustomSplits(
    participantIds: readonly string[],
    amount: string,
    excluded: ReadonlySet<string>,
    manual: ReadonlySet<string>,
    current: Readonly<Record<string, string>>,
): Record<string, string> {
    const automatic = participantIds.filter((id) => !excluded.has(id) && !manual.has(id));
    const remaining = participantIds
        .filter((id) => !excluded.has(id) && manual.has(id))
        .reduce((total, id) => total - amountToMinorUnits(current[id] ?? ''), amountToMinorUnits(amount));
    const shares = automatic.length === 0 ? {} : equalParticipantSplits(automatic, remaining >= 0 ? remaining : 0);
    return Object.fromEntries(participantIds.map((id) => [
        id,
        excluded.has(id) ? '0.00' : manual.has(id) ? (current[id] ?? '') : ((shares[id] ?? 0) / 100).toFixed(2),
    ]));
}
