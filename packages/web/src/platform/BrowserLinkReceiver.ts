import type { LinkHandler, LinkReceiver } from './LinkReceiver';

const OPEN_URL_EVENT = 'fairmoney:open-url';

export class BrowserLinkReceiver implements LinkReceiver {
    async getInitialUrl(): Promise<string | null> {
        return window.location.href;
    }

    subscribe(handler: LinkHandler): () => void {
        const handleNavigation = () => handler(window.location.href);
        const handleOpenUrl = (event: Event) => {
            const url = (event as CustomEvent<string>).detail;
            if (typeof url === 'string') handler(url);
        };

        window.addEventListener('popstate', handleNavigation);
        window.addEventListener('hashchange', handleNavigation);
        window.addEventListener(OPEN_URL_EVENT, handleOpenUrl);
        return () => {
            window.removeEventListener('popstate', handleNavigation);
            window.removeEventListener('hashchange', handleNavigation);
            window.removeEventListener(OPEN_URL_EVENT, handleOpenUrl);
        };
    }
}

export const browserLinkReceiver = new BrowserLinkReceiver();
