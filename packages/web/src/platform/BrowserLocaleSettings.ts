import type { LocaleSettings } from './LocaleSettings';

const LOCALE_KEY = 'fair-money-locale';

export class BrowserLocaleSettings implements LocaleSettings {
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
    private readonly setDocumentLanguage: (locale: string) => void;

    constructor(
        storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
        setDocumentLanguage: (locale: string) => void = (locale) => { document.documentElement.lang = locale; },
    ) {
        this.storage = storage;
        this.setDocumentLanguage = setDocumentLanguage;
    }

    load(): string | null {
        return this.storage.getItem(LOCALE_KEY);
    }

    save(locale: string): void {
        this.storage.setItem(LOCALE_KEY, locale);
        this.setDocumentLanguage(locale);
    }
}
