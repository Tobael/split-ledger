import type { SyncLifecycle } from './SyncLifecycle';

type EventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export class BrowserSyncLifecycle implements SyncLifecycle {
    private readonly onlineEvents: EventSource;
    private readonly visibilityEvents: EventSource;
    private readonly isVisible: () => boolean;
    private readonly intervalMs: number;

    constructor(
        onlineEvents: EventSource = window,
        visibilityEvents: EventSource = document,
        isVisible: () => boolean = () => document.visibilityState === 'visible',
        intervalMs = 30_000,
    ) {
        this.onlineEvents = onlineEvents;
        this.visibilityEvents = visibilityEvents;
        this.isVisible = isVisible;
        this.intervalMs = intervalMs;
    }

    subscribe(requestSync: () => void): () => void {
        const whenOnline = () => requestSync();
        const whenVisible = () => {
            if (this.isVisible()) requestSync();
        };
        this.onlineEvents.addEventListener('online', whenOnline);
        this.visibilityEvents.addEventListener('visibilitychange', whenVisible);
        const interval = globalThis.setInterval(requestSync, this.intervalMs);
        queueMicrotask(requestSync);

        return () => {
            globalThis.clearInterval(interval);
            this.onlineEvents.removeEventListener('online', whenOnline);
            this.visibilityEvents.removeEventListener('visibilitychange', whenVisible);
        };
    }
}
