import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import type { RelayConfig } from './config.js';
import type { RelayDatabase } from './db.js';
import { SourceRateLimiter } from './rate-limiter.js';

interface AuthFields { groupId: string; capability: string; admissionProof?: string }
interface PublishOperationMsg extends AuthFields { type: 'PUBLISH_OPERATION'; operationId: string; encryptedOperation: string }
interface PublishDisposableMsg extends AuthFields { type: 'PUBLISH_DISPOSABLE'; operationId: string; encryptedOperation: string }
interface GetOperationsMsg extends AuthFields { type: 'GET_OPERATIONS'; cursor: number; limit?: number }
interface SubscribeMsg extends AuthFields { type: 'SUBSCRIBE' }
interface ConsumeOperationsMsg extends AuthFields { type: 'CONSUME_OPERATIONS' }
interface PingMsg { type: 'PING' }
type ClientMessage = PublishOperationMsg | PublishDisposableMsg | GetOperationsMsg | SubscribeMsg | ConsumeOperationsMsg | PingMsg;

type ServerMessage =
    | { type: 'OPERATION'; groupId: string; operationId: string; encryptedOperation: string; cursor?: number }
    | { type: 'OPERATIONS_RESPONSE'; groupId: string; operations: Array<{ cursor: number; operationId: string; encryptedOperation: string }>; nextCursor: number; hasMore: boolean }
    | { type: 'OPERATIONS_CONSUMED'; groupId: string; operations: Array<{ operationId: string; encryptedOperation: string }> }
    | { type: 'PONG' }
    | { type: 'ERROR'; code: string; message: string; groupId?: string; admissionDifficulty?: number };

export class RoomManager {
    private rooms = new Map<string, Set<WebSocket>>();
    subscribe(groupId: string, ws: WebSocket): void {
        const room = this.rooms.get(groupId) ?? new Set<WebSocket>();
        room.add(ws); this.rooms.set(groupId, room);
    }
    unsubscribeAll(ws: WebSocket): void {
        for (const [id, room] of this.rooms) { room.delete(ws); if (!room.size) this.rooms.delete(id); }
    }
    broadcast(groupId: string, message: ServerMessage, exclude?: WebSocket): void {
        const data = JSON.stringify(message);
        for (const socket of this.rooms.get(groupId) ?? []) {
            if (socket !== exclude && socket.readyState === WebSocket.OPEN) socket.send(data);
        }
    }
    getSubscriberCount(groupId: string): number { return this.rooms.get(groupId)?.size ?? 0; }
    getTotalConnections(): number { return new Set([...this.rooms.values()].flatMap((room) => [...room])).size; }
}

const groupPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const operationPattern = /^[0-9a-f]{64}$/;
const capabilityPattern = /^[A-Za-z0-9_-]{43}$/;
function capabilityHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function validAdmissionProof(msg: AuthFields, difficulty: number): boolean {
    if (!msg.admissionProof || !/^[0-9a-f]{1,16}$/.test(msg.admissionProof)) return false;
    const digest = createHash('sha256')
        .update(`fair-money-relay-admission-v1:${msg.groupId}:${msg.capability}:${msg.admissionProof}`)
        .digest();
    let zeroBits = 0;
    for (const byte of digest) {
        if (byte === 0) { zeroBits += 8; continue; }
        zeroBits += Math.clz32(byte) - 24;
        break;
    }
    return zeroBits >= difficulty;
}
function authorized(msg: AuthFields, db: RelayDatabase, mode: 'existing' | 'group' | 'disposable'): boolean {
    if (!groupPattern.test(msg.groupId) || !capabilityPattern.test(msg.capability)) return false;
    const digest = capabilityHash(msg.capability);
    const expected = Buffer.from(digest, 'hex');
    const accepted = mode === 'group' ? db.registerGroup(msg.groupId, digest)
        : mode === 'disposable' ? db.registerGroup(msg.groupId, digest, true)
            : db.authorizeGroup(msg.groupId, digest);
    const actual = Buffer.from(accepted ? digest : '', 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function send(ws: WebSocket, message: ServerMessage): void { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function error(ws: WebSocket, code: string, message: string): void { send(ws, { type: 'ERROR', code, message }); }

export function createWsHandler(db: RelayDatabase, config: RelayConfig, rooms: RoomManager) {
    const minute = 60_000;
    const namespaceLimiter = new SourceRateLimiter(config.maxNamespaceCreationsPerIpPerMinute, minute, config.maxRateLimitSources);
    const publishLimiter = new SourceRateLimiter(config.maxPublishesPerIpPerMinute, minute, config.maxRateLimitSources);
    const uploadLimiter = new SourceRateLimiter(config.maxUploadBytesPerIpPerMinute, minute, config.maxRateLimitSources);
    return function handleConnection(ws: WebSocket, _req: IncomingMessage, sourceIp = 'unknown'): void {
        let idle = setTimeout(() => ws.close(1000, 'Idle timeout'), config.wsIdleTimeoutMs);
        const reset = () => { clearTimeout(idle); idle = setTimeout(() => ws.close(1000, 'Idle timeout'), config.wsIdleTimeoutMs); };
        ws.on('message', (raw) => {
            reset();
            let msg: ClientMessage;
            try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch { error(ws, 'PARSE_ERROR', 'Invalid JSON'); return; }
            if (msg.type === 'PING') { send(ws, { type: 'PONG' }); return; }
            const supported = ['SUBSCRIBE', 'PUBLISH_OPERATION', 'PUBLISH_DISPOSABLE', 'GET_OPERATIONS', 'CONSUME_OPERATIONS'];
            if (!supported.includes(msg.type)) { error(ws, 'UNKNOWN_TYPE', 'Unknown message type'); return; }
            if ((msg.type === 'PUBLISH_OPERATION' || msg.type === 'PUBLISH_DISPOSABLE')
                && (!operationPattern.test(msg.operationId) || typeof msg.encryptedOperation !== 'string')) {
                error(ws, 'INVALID_PARAMS', 'Invalid operation envelope'); return;
            }
            // The first holder of an unguessable group capability establishes the
            // opaque relay namespace. Requiring a publish first deadlocks new groups:
            // clients fetch before advertising their local operation set.
            if (!('groupId' in msg)) { error(ws, 'UNAUTHORIZED', 'Invalid group capability'); return; }
            if (groupPattern.test(msg.groupId) && db.isNamespaceBlocked(msg.groupId)) {
                error(ws, 'NAMESPACE_BLOCKED', 'Namespace was removed by the relay operator'); return;
            }
            const isNewNamespace = groupPattern.test(msg.groupId) && capabilityPattern.test(msg.capability)
                && !db.hasGroup(msg.groupId);
            if (isNewNamespace) {
                if (config.admissionDifficultyBits > 0 && !validAdmissionProof(msg, config.admissionDifficultyBits)) {
                    send(ws, {
                        type: 'ERROR', code: 'ADMISSION_REQUIRED', message: 'Namespace admission proof required',
                        groupId: msg.groupId, admissionDifficulty: config.admissionDifficultyBits,
                    });
                    return;
                }
                if (!namespaceLimiter.consume(sourceIp)) {
                    error(ws, 'RATE_LIMITED', 'Namespace creation rate exceeded'); return;
                }
                if (db.getNamespaceCount() >= config.maxNamespaces) {
                    error(ws, 'RELAY_FULL', 'Relay namespace limit reached'); return;
                }
            }
            const mode = msg.type === 'PUBLISH_DISPOSABLE' ? 'disposable' : msg.type === 'CONSUME_OPERATIONS' ? 'existing' : 'group';
            if (!authorized(msg, db, mode) || (msg.type === 'CONSUME_OPERATIONS' && !db.authorizeDisposableGroup(msg.groupId, capabilityHash(msg.capability)))) { error(ws, 'UNAUTHORIZED', 'Invalid group capability'); return; }
            if (msg.type === 'CONSUME_OPERATIONS') {
                const operations = db.consumeGroup(msg.groupId);
                send(ws, { type: 'OPERATIONS_CONSUMED', groupId: msg.groupId, operations: operations.map((operation) => ({ operationId: operation.operationId, encryptedOperation: operation.encryptedData.toString('base64') })) });
                return;
            }
            if (msg.type === 'SUBSCRIBE') { rooms.subscribe(msg.groupId, ws); return; }
            if (msg.type === 'PUBLISH_OPERATION' || msg.type === 'PUBLISH_DISPOSABLE') {
                const bytes = Buffer.from(msg.encryptedOperation, 'base64');
                if (!bytes.length || bytes.length > config.maxOperationSizeBytes) { error(ws, 'OPERATION_SIZE', 'Invalid operation size'); return; }
                if (!publishLimiter.consume(sourceIp) || !uploadLimiter.consume(sourceIp, bytes.length)) {
                    error(ws, 'RATE_LIMITED', 'Publish rate exceeded'); return;
                }
                if (db.getOperationCount(msg.groupId) >= config.maxOperationsPerGroup
                    && !db.hasOperation(msg.groupId, msg.operationId)) {
                    error(ws, 'GROUP_FULL', 'Group is full'); return;
                }
                if (!db.hasOperation(msg.groupId, msg.operationId)
                    && db.getGroupStoredBytes(msg.groupId) + bytes.length > config.maxGroupStorageBytes) {
                    error(ws, 'GROUP_STORAGE_FULL', 'Group storage limit reached'); return;
                }
                if (!db.hasOperation(msg.groupId, msg.operationId)
                    && db.getTotalStoredBytes() + bytes.length > config.maxTotalStorageBytes) {
                    error(ws, 'RELAY_STORAGE_FULL', 'Relay storage limit reached'); return;
                }
                if (db.storeOperation(msg.groupId, msg.operationId, bytes)) {
                    rooms.subscribe(msg.groupId, ws);
                    rooms.broadcast(msg.groupId, { type: 'OPERATION', groupId: msg.groupId, operationId: msg.operationId, encryptedOperation: msg.encryptedOperation }, ws);
                }
                return;
            }
            if (msg.type === 'GET_OPERATIONS') {
                const cursor = Number.isSafeInteger(msg.cursor) && msg.cursor >= 0 ? msg.cursor : -1;
                if (cursor < 0) { error(ws, 'INVALID_CURSOR', 'Cursor must be a non-negative integer'); return; }
                const limit = Math.min(Math.max(msg.limit ?? config.pageSize, 1), config.pageSize);
                const rows = db.getOperationsAfter(msg.groupId, cursor, limit + 1);
                const page = rows.slice(0, limit);
                send(ws, { type: 'OPERATIONS_RESPONSE', groupId: msg.groupId, operations: page.map((row) => ({ cursor: row.cursor, operationId: row.operationId, encryptedOperation: row.encryptedData.toString('base64') })), nextCursor: page.at(-1)?.cursor ?? cursor, hasMore: rows.length > limit });
                rooms.subscribe(msg.groupId, ws); return;
            }
        });
        const cleanup = () => { clearTimeout(idle); rooms.unsubscribeAll(ws); };
        ws.on('close', cleanup); ws.on('error', cleanup);
    };
}
