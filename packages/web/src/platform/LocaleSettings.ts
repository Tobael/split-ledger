export interface LocaleSettings {
    load(): string | null;
    save(locale: string): void;
}
