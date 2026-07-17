import { describe, expect, it, vi } from 'vitest';
import { BrowserLocaleSettings } from './BrowserLocaleSettings';

describe('BrowserLocaleSettings', () => {
    it('loads, persists, and applies the locale', () => {
        let stored: string | null = 'en';
        const storage = {
            getItem: vi.fn(() => stored),
            setItem: vi.fn((_key: string, locale: string) => { stored = locale; }),
        };
        const setDocumentLanguage = vi.fn();
        const settings = new BrowserLocaleSettings(storage, setDocumentLanguage);

        expect(settings.load()).toBe('en');
        settings.save('de');
        expect(settings.load()).toBe('de');
        expect(setDocumentLanguage).toHaveBeenCalledWith('de');
    });
});
