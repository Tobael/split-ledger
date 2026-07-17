import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSyncLifecycle } from './BrowserSyncLifecycle';

afterEach(() => vi.useRealTimers());

describe('BrowserSyncLifecycle', () => {
    it('requests initial, online, visible, and periodic synchronization', async () => {
        vi.useFakeTimers();
        const onlineEvents = new EventTarget();
        const visibilityEvents = new EventTarget();
        let visible = false;
        const requestSync = vi.fn();
        const unsubscribe = new BrowserSyncLifecycle(onlineEvents, visibilityEvents, () => visible, 1_000).subscribe(requestSync);

        await Promise.resolve();
        expect(requestSync).toHaveBeenCalledTimes(1);
        onlineEvents.dispatchEvent(new Event('online'));
        visibilityEvents.dispatchEvent(new Event('visibilitychange'));
        expect(requestSync).toHaveBeenCalledTimes(2);
        visible = true;
        visibilityEvents.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(1_000);
        expect(requestSync).toHaveBeenCalledTimes(4);

        unsubscribe();
        onlineEvents.dispatchEvent(new Event('online'));
        vi.advanceTimersByTime(1_000);
        expect(requestSync).toHaveBeenCalledTimes(4);
    });
});
