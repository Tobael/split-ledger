export interface RelaySettings {
    preferredRelayUrl(): string;
    savePreferredRelayUrl(value: string): string;
    joinBaseUrl(): string;
}

export function normalizeRelayUrl(value: string): string {
    const url = new URL(value.trim());
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    if (url.protocol !== 'wss:' && url.protocol !== 'https:' && !(loopback && (url.protocol === 'ws:' || url.protocol === 'http:'))) {
        throw new Error('Relay URL must use wss:// or https://');
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;
    if (url.pathname === '/' || url.pathname === '') url.pathname = '/ws';
    return url.toString();
}
