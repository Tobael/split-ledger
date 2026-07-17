import type { FileDownload } from './FileDownload';

interface DownloadAnchor {
    href: string;
    download: string;
    click(): void;
}

export class BrowserFileDownload implements FileDownload {
    private readonly createAnchor: () => DownloadAnchor;
    private readonly createObjectUrl: (blob: Blob) => string;
    private readonly revokeObjectUrl: (url: string) => void;

    constructor(
        createAnchor: () => DownloadAnchor = () => document.createElement('a'),
        createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
        revokeObjectUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
    ) {
        this.createAnchor = createAnchor;
        this.createObjectUrl = createObjectUrl;
        this.revokeObjectUrl = revokeObjectUrl;
    }

    download(filename: string, content: string, mediaType: string): void {
        const url = this.createObjectUrl(new Blob([content], { type: mediaType }));
        const anchor = this.createAnchor();
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        this.revokeObjectUrl(url);
    }
}
