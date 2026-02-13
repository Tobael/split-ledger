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
    type: 'NEW_ENTRY';
    groupId: string;
    encryptedEntry: string;
    lamportClock: number;
    senderPubkey: string;
}

interface ServerEntriesResponse {
    type: 'ENTRIES_RESPONSE';
    groupId: string;
    entries: Array<{ encryptedEntry: string; lamportClock: number; senderPubkey: string }>;
}

interface ServerFullLedger {
    type: 'FULL_LEDGER';
    groupId: string;
    entries: Array<{ encryptedEntry: string; lamportClock: number; senderPubkey: string }>;
}

interface ServerPong {
    type: 'PONG';
}

interface ServerError {
    type: 'ERROR';
    code: string;
    message: string;
}

type ServerMessage = ServerNewEntry | ServerEntriesResponse | ServerFullLedger | ServerPong | ServerError;

// ─── Pending Request Tracker ───

interface PendingRequest<T> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

// ─── RelayTransport ───

export interface RelayTransportOptions {
    url: string;
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

    private entryHandlers: OnEntryHandler[] = [];
    private connectionStateHandlers: OnConnectionStateHandler[] = [];
    private connectedGroups = new Set<GroupId>();
    private _connected = false;

    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;

    // Pending request/response tracking
    private pendingGetEntries = new Map<string, PendingRequest<TransportEntry[]>>();
    private pendingGetFull = new Map<string, PendingRequest<TransportEntry[]>>();

    constructor(options: RelayTransportOptions) {
        this.url = options.url;
        this.reconnectIntervalMs = options.reconnectIntervalMs ?? 5000;
        this.pingIntervalMs = options.pingIntervalMs ?? 30000;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 10000;
    }

    get connected(): boolean {
        return this._connected;
    }

    // ─── Connection Management ───

    async connect(groupId: GroupId): Promise<void> {
        this.connectedGroups.add(groupId);

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.ensureConnection(groupId);
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
            type: 'PUBLISH_ENTRY',
            groupId,
            lamportClock: entry.lamportClock,
            senderPubkey: entry.senderPubkey,
            encryptedEntry: entry.encryptedEntry,
        });
    }

    async getEntriesAfter(groupId: GroupId, afterLamportClock: number): Promise<TransportEntry[]> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingGetEntries.delete(groupId);
                reject(new Error('Timeout waiting for ENTRIES_RESPONSE'));
            }, this.requestTimeoutMs);

            this.pendingGetEntries.set(groupId, { resolve, reject, timeout });

            this.send({
                type: 'GET_ENTRIES_AFTER',
                groupId,
                afterLamportClock,
            });
        });
    }

    async getFullLedger(groupId: GroupId): Promise<TransportEntry[]> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingGetFull.delete(groupId);
                reject(new Error('Timeout waiting for FULL_LEDGER'));
            }, this.requestTimeoutMs);

            this.pendingGetFull.set(groupId, { resolve, reject, timeout });

            this.send({
                type: 'GET_FULL_LEDGER',
                groupId,
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

    private async ensureConnection(groupId: GroupId): Promise<void> {
        return new Promise((resolve, reject) => {
            const wsUrl = `${this.url}?groupId=${encodeURIComponent(groupId)}`;

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

    private handleMessage(raw: string): void {
        let msg: ServerMessage;
        try {
            msg = JSON.parse(raw) as ServerMessage;
        } catch {
            return;
        }

        switch (msg.type) {
            case 'PONG':
                // keepalive acknowledged
                break;

            case 'NEW_ENTRY': {
                const entry: TransportEntry = {
                    encryptedEntry: msg.encryptedEntry,
                    lamportClock: msg.lamportClock,
                    senderPubkey: msg.senderPubkey,
                };
                for (const handler of this.entryHandlers) {
                    handler(msg.groupId as GroupId, entry);
                }
                break;
            }

            case 'ENTRIES_RESPONSE': {
                const pending = this.pendingGetEntries.get(msg.groupId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.pendingGetEntries.delete(msg.groupId);
                    pending.resolve(msg.entries);
                }
                break;
            }

            case 'FULL_LEDGER': {
                const pending = this.pendingGetFull.get(msg.groupId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.pendingGetFull.delete(msg.groupId);
                    pending.resolve(msg.entries);
                }
                break;
            }

            case 'ERROR':
                console.error(`[RelayTransport] Server error: ${msg.code} — ${msg.message}`);
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
        for (const [, pending] of this.pendingGetFull) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Connection closed'));
        }
        this.pendingGetFull.clear();
    }

    private emitConnectionState(state: 'connected' | 'disconnected' | 'reconnecting'): void {
        for (const handler of this.connectionStateHandlers) {
            handler(state);
        }
    }
}
