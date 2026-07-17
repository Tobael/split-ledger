import { normalizeRelayUrl, type RelaySettings } from './RelaySettings';

const RELAY_PREFERENCE_KEY = 'fair-money-preferred-relay';

export class BrowserRelaySettings implements RelaySettings {
    private readonly configuredRelayUrl: string | undefined;
    private readonly location: Pick<Location, 'protocol' | 'host' | 'origin'>;
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'>;

    constructor(configuredRelayUrl: string | undefined, location: Pick<Location, 'protocol' | 'host' | 'origin'> = window.location, storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage) {
        this.configuredRelayUrl = configuredRelayUrl;
        this.location = location;
        this.storage = storage;
    }

    preferredRelayUrl(): string {
        return this.storage.getItem(RELAY_PREFERENCE_KEY) ?? this.defaultRelayUrl();
    }

    savePreferredRelayUrl(value: string): string {
        const normalized = normalizeRelayUrl(value);
        this.storage.setItem(RELAY_PREFERENCE_KEY, normalized);
        return normalized;
    }

    joinBaseUrl(): string {
        return this.location.origin;
    }

    private defaultRelayUrl(): string {
        if (this.configuredRelayUrl) return normalizeRelayUrl(this.configuredRelayUrl);
        const protocol = this.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${protocol}://${this.location.host}/ws`;
    }
}
