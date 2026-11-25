import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelayTransport } from '../sync/relay-transport.js';
import type { GroupId } from '../types.js';

class Socket extends EventTarget {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 0;
    sent: Record<string, unknown>[] = [];
    constructor(_url: string) { super(); Socket.instances.push(this); }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    message(value: unknown) { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(value) })); }
}
const id = '00000000-0000-4000-8000-000000000001' as GroupId;
const transports: RelayTransport[] = [];
function client() {
    vi.stubGlobal('WebSocket', Socket);
    const transport = new RelayTransport({ url: 'wss://relay.example/ws', groupCapabilities: { [id]: 'A'.repeat(43) }, requestTimeoutMs: 100 });
    transports.push(transport);
    return transport;
}
async function opened() {
    const transport = client();
    const connecting = transport.connect(id);
    const socket = Socket.instances.at(-1)!;
    socket.open();
    await connecting;
    return { transport, socket };
}
afterEach(async () => {
    await Promise.all(transports.splice(0).map((transport) => transport.disconnectAll()));
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Socket.instances = [];
});
describe('relay transport failure handling', () => {
    it('bounds a handshake that never opens and allows a later retry', async () => {
        vi.useFakeTimers();
        const transport = client();
        const rejected = expect(transport.connect(id)).rejects.toThrow('Timeout connecting');
        await vi.advanceTimersByTimeAsync(101);
        await rejected;
        const retried = transport.connect(id);
        Socket.instances.at(-1)!.open();
        await retried;
        expect(transport.connected).toBe(true);
    });
    it('rejects closure during the handshake and cancellation', async () => {
        const transport = client();
        const rejected = expect(transport.connect(id)).rejects.toThrow('Connection closed');
        Socket.instances.at(-1)!.close();
        await rejected;
        const cancelled = expect(transport.connect(id)).rejects.toThrow('Connection closed');
        await transport.disconnectAll();
        await cancelled;
    });
    it('rejects disconnected publication instead of pretending it was sent', async () => {
        const transport = client();
        await expect(transport.publishEntry(id, { operationId: 'a'.repeat(64), encryptedOperation: 'opaque' })).rejects.toThrow('disconnected');
    });
    it('rejects relay errors promptly and prevents infinite cursor pagination', async () => {
        const { transport, socket } = await opened();
        const rejected = expect(transport.getOperations(id)).rejects.toThrow('UNAUTHORIZED');
        socket.message({ type: 'ERROR', groupId: id, code: 'UNAUTHORIZED', message: 'Rejected' });
        await rejected;
        const invalidCursor = expect(transport.getOperations(id)).rejects.toThrow('pagination did not advance');
        socket.message({ type: 'OPERATIONS_RESPONSE', groupId: id, operations: [], nextCursor: 0, hasMore: true });
        await invalidCursor;
    });
    it('ignores malformed relay responses without throwing from an event handler', async () => {
        vi.useFakeTimers();
        const { transport, socket } = await opened();
        const rejected = expect(transport.getOperations(id)).rejects.toThrow('Timeout');
        expect(() => socket.message({ type: 'OPERATIONS_RESPONSE', groupId: id, operations: null })).not.toThrow();
        await vi.advanceTimersByTimeAsync(101);
        await rejected;
    });
});
