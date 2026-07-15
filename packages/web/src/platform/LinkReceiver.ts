export type LinkHandler = (url: string) => void;

/** Platform boundary for browser navigation, iOS Universal Links, and Android App Links. */
export interface LinkReceiver {
    getInitialUrl(): Promise<string | null>;
    subscribe(handler: LinkHandler): () => void;
}

/** Extract an invite reference, preserving a v2 fragment decryption key when present. */
export function inviteTokenFromUrl(input: string): string | null {
    try {
        const url = new URL(input);
        const queryToken = url.searchParams.get('token');
        if (queryToken && (url.pathname === '/join' || url.pathname === '/invite')) return queryToken;

        const match = url.pathname.match(/^\/(?:invite|join)\/([^/]+)\/?$/);
        if (!match?.[1]) return null;
        const token = decodeURIComponent(match[1]);
        const fragmentKey = new URLSearchParams(url.hash.slice(1)).get('key');
        return fragmentKey ? `${token}#key=${encodeURIComponent(fragmentKey)}` : token;
    } catch {
        return null;
    }
}
