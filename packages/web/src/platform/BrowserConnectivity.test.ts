import { describe, expect, it, vi } from 'vitest';
import { BrowserConnectivity } from './BrowserConnectivity';

describe('BrowserConnectivity', () => {
    it('reports changes and removes its listeners', () => {
        const events = new EventTarget();
        let online = true;
        const connectivity = new BrowserConnectivity(events, () => online);
        const handler = vi.fn();
        const unsubscribe = connectivity.subscribe(handler);

        expect(connectivity.isOnline()).toBe(true);
        online = false;
        events.dispatchEvent(new Event('offline'));
        online = true;
        events.dispatchEvent(new Event('online'));
        expect(handler.mock.calls).toEqual([[false], [true]]);

        unsubscribe();
        events.dispatchEvent(new Event('offline'));
        expect(handler).toHaveBeenCalledTimes(2);
    });
});
