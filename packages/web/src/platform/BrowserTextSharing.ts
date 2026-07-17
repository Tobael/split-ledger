import type { TextSharing } from './TextSharing';

export class BrowserTextSharing implements TextSharing {
    private readonly writeText: (text: string) => Promise<void>;

    constructor(writeText: (text: string) => Promise<void> = (text) => navigator.clipboard.writeText(text)) {
        this.writeText = writeText;
    }

    copy(text: string): Promise<void> {
        return this.writeText(text);
    }
}
