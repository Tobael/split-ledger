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
