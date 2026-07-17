export interface SyncLifecycle {
    subscribe(requestSync: () => void): () => void;
}
