import { describe, expect, it } from 'vitest';
import { BrowserRelaySettings } from './BrowserRelaySettings';
import { normalizeRelayUrl } from './RelaySettings';

const location = { protocol: 'https:', host: 'money.example.org', origin: 'https://money.example.org' };

function memoryStorage(initial: string | null = null) {
    let value = initial;
    return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
}

describe('relay settings', () => {
    it('uses and normalizes the configured relay', () => {
        expect(new BrowserRelaySettings('https://relay.example.org', location, memoryStorage()).preferredRelayUrl()).toBe('wss://relay.example.org/ws');
    });

    it('persists a normalized preference', () => {
        const storage = memoryStorage();
        const settings = new BrowserRelaySettings(undefined, location, storage);
        expect(settings.savePreferredRelayUrl('https://self-hosted.example/ws')).toBe('wss://self-hosted.example/ws');
        expect(settings.preferredRelayUrl()).toBe('wss://self-hosted.example/ws');
    });

    it('provides the web origin for invitation links', () => {
        expect(new BrowserRelaySettings(undefined, location, memoryStorage()).joinBaseUrl()).toBe(location.origin);
    });

    it('allows insecure relay URLs only on loopback', () => {
        expect(normalizeRelayUrl('http://localhost:8443')).toBe('ws://localhost:8443/ws');
        expect(() => normalizeRelayUrl('ws://relay.example.org/ws')).toThrow();
    });
});
