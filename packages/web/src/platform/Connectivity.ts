export interface Connectivity {
    isOnline(): boolean;
    subscribe(handler: (online: boolean) => void): () => void;
}
