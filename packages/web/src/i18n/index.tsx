/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en';
import de from './de';
import type { Translations } from './en';
import { BrowserLocaleSettings } from '../platform/BrowserLocaleSettings';

// ─── Supported Locales ───

export type Locale = 'en' | 'de';

const translations: Record<Locale, Translations> = { en, de };

export const localeLabels: Record<Locale, string> = {
    en: 'English',
    de: 'Deutsch',
};

export const supportedLocales: Locale[] = ['en', 'de'];

// ─── Detect default locale ───

function detectLocale(stored: string | null): Locale {
    if (stored && stored in translations) return stored as Locale;

    // Default to German
    return 'de';
}

// ─── Context ───

interface I18nContextValue {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: Translations;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
    const localeSettings = useMemo(() => new BrowserLocaleSettings(), []);
    const [locale, setLocale] = useState<Locale>(() => detectLocale(localeSettings.load()));

    useEffect(() => localeSettings.save(locale), [locale, localeSettings]);

    const t = translations[locale];

    return (
        <I18nContext.Provider value={{ locale, setLocale, t }
        }>
            {children}
        </I18nContext.Provider>
    );
}

// ─── Hook ───

export function useI18n() {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error('useI18n must be used within I18nProvider');
    return ctx;
}
