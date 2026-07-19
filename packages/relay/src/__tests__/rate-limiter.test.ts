import { describe, expect, it } from 'vitest';
import { SourceRateLimiter } from '../rate-limiter.js';

describe('source rate limiter', () => {
    it('shares a fixed allowance by source and resets after the window', () => {
        const limiter = new SourceRateLimiter(3, 1000, 10);
        expect(limiter.consume('a', 2, 0)).toBe(true);
        expect(limiter.consume('a', 2, 1)).toBe(false);
        expect(limiter.consume('b', 3, 1)).toBe(true);
        expect(limiter.consume('a', 3, 1000)).toBe(true);
    });

    it('bounds tracked sources and frees expired buckets', () => {
        const limiter = new SourceRateLimiter(1, 1000, 1);
        expect(limiter.consume('a', 1, 0)).toBe(true);
        expect(limiter.consume('b', 1, 1)).toBe(false);
        expect(limiter.consume('b', 1, 1000)).toBe(true);
    });
});
