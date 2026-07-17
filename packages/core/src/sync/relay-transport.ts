// =============================================================================
// SplitLedger — Relay Transport (WebSocket Client)
// =============================================================================
//
// Client-side WebSocket transport connecting to the relay server.
// Handles reconnection, message parsing, PING/PONG keepalive.
//

import type { GroupId } from '../types.js';
import type {
    Transport,
    TransportEntry,
    OnEntryHandler,
    OnConnectionStateHandler,
} from './transport.js';

// ─── Server Message Types (matching ws-handler.ts) ───

interface ServerNewEntry {
    type: 'OPERATION';
    groupId: string;
    operationId: string;
    encryptedOperation: string;
}

interface ServerEntriesResponse {
    type: 'OPERATIONS_RESPONSE';
    groupId: string;
    operations: Array<{ cursor: number; operationId: string; encryptedOperation: string }>;
    nextCursor: number;
    hasMore: boolean;
}

interface ServerOperationsConsumed {
    type: 'OPERATIONS_CONSUMED';
    groupId: string;
    operations: Array<{ operationId: string; encryptedOperation: string }>;
}

interface ServerPong {
    type: 'PONG';
}

interface ServerError {
    type: 'ERROR';
    code: string;
    message: string;
}

type ServerMessage = ServerNewEntry | ServerEntriesResponse | ServerOperationsConsumed | ServerPong | ServerError;

// ─── Pending Request Tracker ───

interface PendingRequest<T> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

interface RelayPage {
    entries: TransportEntry[];
    nextCursor: number;
    hasMore: boolean;
}

// ─── RelayTransport ───

export interface RelayTransportOptions {
    url: string;
    groupCapabilities?: Record<string, string>;
    reconnectIntervalMs?: number;
    pingIntervalMs?: number;
    requestTimeoutMs?: number;
}

export class RelayTransport implements Transport {
    private ws: WebSocket | null = null;
    private readonly url: string;
    private readonly reconnectIntervalMs: number;
    private readonly pingIntervalMs: number;
    private readonly requestTimeoutMs: number;
    private readonly groupCapabilities = new Map<string, string>();

    private entryHandlers: OnEntryHandler[] = [];
    private connectionStateHandlers: OnConnectionStateHandler[] = [];
    private connectedGroups = new Set<GroupId>();
    private _connected = false;

    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;

    // Pending request/response tracking
    private pendingGetEntries = new Map<string, PendingRequest<RelayPage>>();
    private pendingConsumeEntries = new Map<string, PendingRequest<TransportEntry[]>>();

    constructor(options: RelayTransportOptions) {
        this.url = options.url;
        this.reconnectIntervalMs = options.reconnectIntervalMs ?? 5000;
        this.pingIntervalMs = options.pingIntervalMs ?? 30000;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 10000;
        for (const [groupId, capability] of Object.entries(options.groupCapabilities ?? {})) {
            this.groupCapabilities.set(groupId, capability);
        }
    }

    get connected(): boolean {
        return this._connected;
    }

    getConnectedGroups(): GroupId[] {
        return Array.from(this.connectedGroups);
    }

    setGroupCapability(groupId: GroupId, capability: string): void {
        this.groupCapabilities.set(groupId, capability);
    }

    private capability(groupId: GroupId): string {
        const capability = this.groupCapabilities.get(groupId);
        if (!capability) throw new Error(`Missing relay group capability for ${groupId}`);
        return capability;
    }

    // ─── Connection Management ───

    async connect(groupId: GroupId): Promise<void> {
        this.connectedGroups.add(groupId);

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.ensureConnection(groupId);
        } else {
            // Already connected, just subscribe to the new group
            this.send({
                type: 'SUBSCRIBE',
                groupId,
                capability: this.capability(groupId),
            });
        }
    }

    async disconnect(groupId: GroupId): Promise<void> {
        this.connectedGroups.delete(groupId);
    }

    async disconnectAll(): Promise<void> {
        this.connectedGroups.clear();
        this.cleanup();
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }
        this._connected = false;
    }

    // ─── Entry Operations ───

    async publishEntry(groupId: GroupId, entry: TransportEntry): Promise<void> {
        this.send({
            type: 'PUBLISH_OPERATION',
            groupId,
            capability: this.capability(groupId),
            operationId: entry.operationId,
            encryptedOperation: entry.encryptedOperation,
        });
    }

    async publishDisposableEntry(groupId: GroupId, entry: TransportEntry): Promise<void> {
        this.send({
            type: 'PUBLISH_DISPOSABLE',
            groupId,
            capability: this.capability(groupId),
            operationId: entry.operationId,
            encryptedOperation: entry.encryptedOperation,
        });
    }

    async getOperations(groupId: GroupId): Promise<TransportEntry[]> {
        const entries: TransportEntry[] = [];
        let cursor = 0;
        do {
            const page = await this.requestPage(groupId, cursor);
            entries.push(...page.entries);
            cursor = page.nextCursor;
            if (!page.hasMore) break;
        } while (true);
        return entries;
    }

    consumeEntries(groupId: GroupId): Promise<TransportEntry[]> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingConsumeEntries.delete(groupId);
                reject(new Error('Timeout waiting for OPERATIONS_CONSUMED'));
            }, this.requestTimeoutMs);
            this.pendingConsumeEntries.set(groupId, { resolve, reject, timeout });
            this.send({ type: 'CONSUME_OPERATIONS', groupId, capability: this.capability(groupId) });
        });
    }

    private requestPage(groupId: GroupId, cursor: number): Promise<RelayPage> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingGetEntries.delete(groupId);
                reject(new Error('Timeout waiting for ENTRIES_RESPONSE'));
            }, this.requestTimeoutMs);

            this.pendingGetEntries.set(groupId, { resolve, reject, timeout });

            this.send({
                type: 'GET_OPERATIONS',
                groupId,
                capability: this.capability(groupId),
                cursor,
            });
        });
    }

    // ─── Event Handlers ───

    onEntry(handler: OnEntryHandler): void {
        this.entryHandlers.push(handler);
    }

    onConnectionState(handler: OnConnectionStateHandler): void {
        this.connectionStateHandlers.push(handler);
    }

    // ─── Internal ───

    private async ensureConnection(_groupId: GroupId): Promise<void> {
        return new Promise((resolve, reject) => {
            const wsUrl = this.url;

            try {
                this.ws = new WebSocket(wsUrl);
            } catch (err) {
                reject(err);
                return;
            }

            const onOpen = () => {
                this._connected = true;
                this.emitConnectionState('connected');
                this.startPingInterval();
                this.subscribeToAllGroups();
                resolve();
            };

            const onError = (_event: Event) => {
                if (!this._connected) {
                    reject(new Error('WebSocket connection failed'));
                }
            };

            this.ws.addEventListener('open', onOpen, { once: true });
            this.ws.addEventListener('error', onError, { once: true });

            this.ws.addEventListener('message', (event) => {
                this.handleMessage(event.data as string);
            });

            this.ws.addEventListener('close', () => {
                this._connected = false;
                this.cleanup();
                this.emitConnectionState('disconnected');
                this.scheduleReconnect();
            });
        });
    }

    private async subscribeToAllGroups(): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        for (const groupId of this.connectedGroups) {
            this.send({
                type: 'SUBSCRIBE',
                groupId,
                capability: this.capability(groupId),
            });
        }
    }

    private handleMessage(raw: string): void {
        let msg: ServerMessage;
        try {
            msg = JSON.parse(raw) as ServerMessage;
        } catch {
            console.warn('[RelayTransport] Rejected malformed server message');
            return;
        }

        switch (msg.type) {
            case 'PONG':
                // keepalive acknowledged
                break;

            case 'OPERATION': {
                const entry: TransportEntry = {
                    operationId: msg.operationId,
                    encryptedOperation: msg.encryptedOperation,
                };
                for (const handler of this.entryHandlers) {
                    handler(msg.groupId as GroupId, entry);
                }
                break;
            }

            case 'OPERATIONS_RESPONSE': {
                const pending = this.pendingGetEntries.get(msg.groupId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.pendingGetEntries.delete(msg.groupId);
                    pending.resolve({
                        entries: msg.operations.map((operation) => ({
                            operationId: operation.operationId,
                            encryptedOperation: operation.encryptedOperation,
                            cursor: operation.cursor,
                        })),
                        nextCursor: msg.nextCursor,
                        hasMore: msg.hasMore,
                    });
                }
                break;
            }

            case 'OPERATIONS_CONSUMED': {
                const pending = this.pendingConsumeEntries.get(msg.groupId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.pendingConsumeEntries.delete(msg.groupId);
                    pending.resolve(msg.operations);
                }
                break;
            }

            case 'ERROR':
                console.error(`[RelayTransport] Server error: ${msg.code}`);
                break;
        }
    }

    private send(msg: unknown): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    private startPingInterval(): void {
        this.stopPingInterval();
        this.pingTimer = setInterval(() => {
            this.send({ type: 'PING' });
        }, this.pingIntervalMs);
    }

    private stopPingInterval(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    private scheduleReconnect(): void {
        if (this.connectedGroups.size === 0) return;
        if (this.reconnectTimer) return;

        this.emitConnectionState('reconnecting');
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            const firstGroup = this.connectedGroups.values().next().value;
            if (firstGroup) {
                try {
                    await this.ensureConnection(firstGroup);
                } catch {
                    this.scheduleReconnect();
                }
            }
        }, this.reconnectIntervalMs);
    }

    private cleanup(): void {
        this.stopPingInterval();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // Reject all pending requests
        for (const [, pending] of this.pendingGetEntries) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Connection closed'));
        }
        this.pendingGetEntries.clear();
        for (const [, pending] of this.pendingConsumeEntries) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Connection closed'));
        }
        this.pendingConsumeEntries.clear();
    }

    private emitConnectionState(state: 'connected' | 'disconnected' | 'reconnecting'): void {
        for (const handler of this.connectionStateHandlers) {
            handler(state);
        }
    }
}
