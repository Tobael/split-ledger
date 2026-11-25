import { describe, expect, it } from 'vitest';

import { equalParticipantSplits, rebalanceCustomSplits } from './expense-splits';

describe('equalParticipantSplits', () => {
    it('distributes indivisible cents deterministically', () => {
        expect(equalParticipantSplits(['alice', 'bob', 'charlie'], 1000)).toEqual({
            alice: 334,
            bob: 333,
            charlie: 333,
        });
    });

    it('sets excluded participants to zero and redistributes the full amount', () => {
        expect(equalParticipantSplits(['alice', 'bob', 'charlie'], 1001, new Set(['bob']))).toEqual({
            alice: 501,
            bob: 0,
            charlie: 500,
        });
    });

    it('rejects excluding every participant', () => {
        expect(() => equalParticipantSplits(['alice'], 100, new Set(['alice']))).toThrow('one participant');
    });
});

describe('rebalanceCustomSplits', () => {
    const ids = ['alice', 'bob', 'charlie', 'dana'];

    it('distributes the remaining cents while preserving manual and excluded shares', () => {
        const excluded = new Set(['dana']);
        const splits = rebalanceCustomSplits(ids, '10.00', excluded, new Set(['alice']), { alice: '3.01' });
        expect(splits).toEqual({ alice: '3.01', bob: '3.50', charlie: '3.49', dana: '0.00' });
        expect(rebalanceCustomSplits(ids, '12.00', excluded, new Set(['alice', 'bob']), {
            ...splits, bob: '4',
        })).toEqual({ alice: '3.01', bob: '4', charlie: '4.99', dana: '0.00' });
    });

    it('preserves an overallocated manual share and keeps automatic shares nonnegative', () => {
        expect(rebalanceCustomSplits(['alice', 'bob'], '10', new Set(), new Set(['alice']), {
            alice: '11',
        })).toEqual({ alice: '11', bob: '0.00' });
    });

    it('leaves the amounts available for validation when every share is manual', () => {
        const shares = { alice: '3', bob: '4' };
        expect(rebalanceCustomSplits(['alice', 'bob'], '10', new Set(), new Set(['alice', 'bob']), shares))
            .toEqual(shares);
    });
});
