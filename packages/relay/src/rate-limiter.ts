interface RateBucket {
    count: number;
    startedAt: number;
}

/** Shared fixed-window limiter with bounded source tracking. */
export class SourceRateLimiter {
    private readonly buckets = new Map<string, RateBucket>();
    private lastPrunedAt = 0;

    constructor(
        private readonly limit: number,
        private readonly windowMs: number,
        private readonly maxSources: number,
    ) {}

    consume(source: string, amount = 1, now = Date.now()): boolean {
        if (now - this.lastPrunedAt >= this.windowMs) this.prune(now);
        const current = this.buckets.get(source);
        if (!current || now - current.startedAt >= this.windowMs) {
            if (!current && this.buckets.size >= this.maxSources) return false;
            if (amount > this.limit) return false;
            this.buckets.set(source, { count: amount, startedAt: now });
            return true;
        }
        if (current.count + amount > this.limit) return false;
        current.count += amount;
        return true;
    }

    private prune(now: number): void {
        for (const [source, bucket] of this.buckets) {
            if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(source);
        }
        this.lastPrunedAt = now;
    }
}
