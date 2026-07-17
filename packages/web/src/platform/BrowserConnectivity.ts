import type { Connectivity } from './Connectivity';

type EventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export class BrowserConnectivity implements Connectivity {
    private readonly events: EventSource;
    private readonly readOnline: () => boolean;

    constructor(events: EventSource = window, readOnline: () => boolean = () => navigator.onLine) {
        this.events = events;
        this.readOnline = readOnline;
    }

    isOnline(): boolean {
        return this.readOnline();
    }

    subscribe(handler: (online: boolean) => void): () => void {
        const update = () => handler(this.readOnline());
        this.events.addEventListener('online', update);
        this.events.addEventListener('offline', update);
        return () => {
            this.events.removeEventListener('online', update);
            this.events.removeEventListener('offline', update);
        };
    }
}
