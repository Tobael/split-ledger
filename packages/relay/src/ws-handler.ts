// =============================================================================
// SplitLedger Relay — WebSocket Handler
// =============================================================================

import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import type { RelayDatabase } from './db.js';
import type { RelayConfig } from './config.js';

// ─── Protocol Types ───

interface PublishEntryMsg {
    type: 'PUBLISH_ENTRY';
    groupId: string;
    lamportClock: number;
    senderPubkey: string;
    encryptedEntry: string; // base64
}

interface GetEntriesAfterMsg {
    type: 'GET_ENTRIES_AFTER';
    groupId: string;
    afterLamportClock: number;
}

interface GetFullLedgerMsg {
    type: 'GET_FULL_LEDGER';
    groupId: string;
}

interface PingMsg {
    type: 'PING';
}

// ─── Signaling Types (WebRTC) ───

interface SignalOfferMsg {
    type: 'SIGNAL_OFFER';
    groupId: string;
    fromPeerId: string;
    toPeerId: string;
    sdp: string;
}

interface SignalAnswerMsg {
    type: 'SIGNAL_ANSWER';
    groupId: string;
    fromPeerId: string;
    toPeerId: string;
    sdp: string;
}

interface SignalIceMsg {
    type: 'SIGNAL_ICE';
    groupId: string;
    fromPeerId: string;
    toPeerId: string;
    candidate: unknown;
}

type SignalMsg = SignalOfferMsg | SignalAnswerMsg | SignalIceMsg;

type ClientMessage = PublishEntryMsg | GetEntriesAfterMsg | GetFullLedgerMsg | PingMsg | SignalMsg;

interface NewEntryMsg {
    type: 'NEW_ENTRY';
    groupId: string;
    encryptedEntry: string;
    lamportClock: number;
    senderPubkey: string;
}

interface EntriesResponseMsg {
    type: 'ENTRIES_RESPONSE';
    groupId: string;
    entries: Array<{ encryptedEntry: string; lamportClock: number; senderPubkey: string }>;
}

interface FullLedgerMsg {
    type: 'FULL_LEDGER';
    groupId: string;
    entries: Array<{ encryptedEntry: string; lamportClock: number; senderPubkey: string }>;
}

interface PongMsg {
    type: 'PONG';
}

interface ErrorMsg {
    type: 'ERROR';
    code: string;
    message: string;
}

type ServerMessage = NewEntryMsg | EntriesResponseMsg | FullLedgerMsg | PongMsg | ErrorMsg;

// ─── Subscription Room Manager ───

export class RoomManager {
    private rooms = new Map<string, Set<WebSocket>>();
    /** Maps peerId → WebSocket for signaling */
    private peerSockets = new Map<string, WebSocket>();

    subscribe(groupId: string, ws: WebSocket): void {
        let room = this.rooms.get(groupId);
        if (!room) {
            room = new Set();
            this.rooms.set(groupId, room);
        }
        room.add(ws);
    }

    unsubscribe(groupId: string, ws: WebSocket): void {
        const room = this.rooms.get(groupId);
        if (room) {
            room.delete(ws);
            if (room.size === 0) this.rooms.delete(groupId);
        }
    }

    unsubscribeAll(ws: WebSocket): void {
        for (const [groupId, room] of this.rooms) {
            room.delete(ws);
            if (room.size === 0) this.rooms.delete(groupId);
        }
        // Remove peer identity
        for (const [peerId, sock] of this.peerSockets) {
            if (sock === ws) {
                this.peerSockets.delete(peerId);
            }
        }
    }

    registerPeer(peerId: string, ws: WebSocket): void {
        this.peerSockets.set(peerId, ws);
    }

    getPeerSocket(peerId: string): WebSocket | undefined {
        return this.peerSockets.get(peerId);
    }

    broadcast(groupId: string, message: ServerMessage, exclude?: WebSocket): void {
        const room = this.rooms.get(groupId);
        if (!room) return;
        const data = JSON.stringify(message);
        for (const ws of room) {
            if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        }
    }

    getSubscriberCount(groupId: string): number {
        return this.rooms.get(groupId)?.size ?? 0;
    }

    getTotalConnections(): number {
        const unique = new Set<WebSocket>();
        for (const room of this.rooms.values()) {
            for (const ws of room) unique.add(ws);
        }
        return unique.size;
    }
}

// ─── Message Handler ───

export function createWsHandler(db: RelayDatabase, config: RelayConfig, rooms: RoomManager) {
    return function handleConnection(ws: WebSocket, req: IncomingMessage): void {
        // Parse groupId from URL query params
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const groupId = url.searchParams.get('groupId');
        console.log(`[Relay] New connection from ${req.socket.remoteAddress} for group ${groupId || 'none'}`);

        if (groupId) {
            rooms.subscribe(groupId, ws);
        }

        // Idle timeout
        let idleTimer = setTimeout(() => ws.close(1000, 'Idle timeout'), config.wsIdleTimeoutMs);
        const resetIdle = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => ws.close(1000, 'Idle timeout'), config.wsIdleTimeoutMs);
        };

        ws.on('message', (raw) => {
            resetIdle();

            let msg: ClientMessage;
            try {
                msg = JSON.parse(raw.toString()) as ClientMessage;
                console.log(`[Relay] Received ${msg.type} from ${req.socket.remoteAddress}`);
            } catch {
                sendError(ws, 'PARSE_ERROR', 'Invalid JSON');
                return;
            }

            switch (msg.type) {
                case 'PING':
                    send(ws, { type: 'PONG' });
                    break;

                case 'PUBLISH_ENTRY':
                    handlePublishEntry(ws, msg, db, config, rooms);
                    break;

                case 'GET_ENTRIES_AFTER':
                    handleGetEntriesAfter(ws, msg, db, rooms);
                    break;

                case 'GET_FULL_LEDGER':
                    handleGetFullLedger(ws, msg, db, rooms);
                    break;

                case 'SIGNAL_OFFER':
                case 'SIGNAL_ANSWER':
                case 'SIGNAL_ICE':
                    handleSignaling(ws, msg, rooms);
                    break;

                default:
                    sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${(msg as { type: string }).type}`);
            }
        });

        ws.on('close', () => {
            clearTimeout(idleTimer);
            rooms.unsubscribeAll(ws);
        });

        ws.on('error', () => {
            clearTimeout(idleTimer);
            rooms.unsubscribeAll(ws);
        });
    };
}

function handlePublishEntry(
    ws: WebSocket,
    msg: PublishEntryMsg,
    db: RelayDatabase,
    config: RelayConfig,
    rooms: RoomManager,
): void {
    const { groupId, lamportClock, senderPubkey, encryptedEntry } = msg;

    if (!groupId || !encryptedEntry || senderPubkey === undefined) {
        sendError(ws, 'INVALID_PARAMS', 'Missing required fields');
        return;
    }

    // Size check
    const data = Buffer.from(encryptedEntry, 'base64');
    if (data.length > config.maxEntrySizeBytes) {
        sendError(ws, 'ENTRY_TOO_LARGE', `Entry exceeds max size of ${config.maxEntrySizeBytes} bytes`);
        return;
    }

    // Entry limit check
    const count = db.getEntryCount(groupId);
    if (count >= config.maxEntriesPerGroup) {
        sendError(ws, 'GROUP_FULL', 'Group has reached maximum entry count');
        return;
    }

    // Store
    const stored = db.storeEntry(groupId, lamportClock, data, senderPubkey);
    if (!stored) {
        // Duplicate entry — silently accepted (idempotent)
        return;
    }

    // Subscribe sender to group if not already
    rooms.subscribe(groupId, ws);

    // Broadcast to all other subscribers in this group
    rooms.broadcast(
        groupId,
        {
            type: 'NEW_ENTRY',
            groupId,
            encryptedEntry,
            lamportClock,
            senderPubkey,
        },
        ws, // exclude sender
    );
}

function handleGetEntriesAfter(ws: WebSocket, msg: GetEntriesAfterMsg, db: RelayDatabase, rooms: RoomManager): void {
    const { groupId, afterLamportClock } = msg;
    if (!groupId || afterLamportClock === undefined) {
        sendError(ws, 'INVALID_PARAMS', 'Missing required fields');
        return;
    }

    const entries = db.getEntriesAfter(groupId, afterLamportClock);
    send(ws, {
        type: 'ENTRIES_RESPONSE',
        groupId,
        entries: entries.map((e) => ({
            encryptedEntry: (e.encryptedData as unknown as Buffer).toString('base64'),
            lamportClock: e.lamportClock,
            senderPubkey: e.senderPubkey,
        })),
    });

    // Also subscribe for future updates
    rooms.subscribe(groupId, ws);
}

function handleGetFullLedger(ws: WebSocket, msg: GetFullLedgerMsg, db: RelayDatabase, rooms: RoomManager): void {
    const { groupId } = msg;
    if (!groupId) {
        sendError(ws, 'INVALID_PARAMS', 'Missing groupId');
        return;
    }

    const entries = db.getFullLedger(groupId);
    send(ws, {
        type: 'FULL_LEDGER',
        groupId,
        entries: entries.map((e) => ({
            encryptedEntry: (e.encryptedData as unknown as Buffer).toString('base64'),
            lamportClock: e.lamportClock,
            senderPubkey: e.senderPubkey,
        })),
    });

    rooms.subscribe(groupId, ws);
}

function handleSignaling(_ws: WebSocket, msg: SignalMsg, rooms: RoomManager): void {
    const { fromPeerId, toPeerId } = msg;

    // Register the sender's peer identity
    rooms.registerPeer(fromPeerId, _ws);

    // Forward to target peer
    const targetWs = rooms.getPeerSocket(toPeerId);
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(msg));
    }
    // If target not found, silently drop (they may be offline)
}

// ─── Helpers ───

function send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function sendError(ws: WebSocket, code: string, message: string): void {
    send(ws, { type: 'ERROR', code, message });
}
