import { describe, expect, it } from 'vitest';

import { equalParticipantSplits } from './expense-splits';

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
