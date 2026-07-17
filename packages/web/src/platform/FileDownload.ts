export interface FileDownload {
    download(filename: string, content: string, mediaType: string): void;
}
