import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelayTransport } from '../sync/relay-transport.js';

class AdmissionWebSocket {
    static readonly OPEN = 1;
    readonly sent: Array<Record<string, unknown>> = [];
    readyState = AdmissionWebSocket.OPEN;
    private readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();

    constructor(_url: string) {
        queueMicrotask(() => this.emit('open', {}));
    }

    addEventListener(type: string, listener: (event: { data?: string }) => void): void {
        const entries = this.listeners.get(type) ?? [];
        entries.push(listener);
        this.listeners.set(type, entries);
    }

    send(raw: string): void {
        const message = JSON.parse(raw) as Record<string, unknown>;
        this.sent.push(message);
        if (message['type'] === 'SUBSCRIBE' && !message['admissionProof']) {
            queueMicrotask(() => this.emit('message', { data: JSON.stringify({
                type: 'ERROR', code: 'ADMISSION_REQUIRED', message: 'Proof required',
                groupId: message['groupId'], admissionDifficulty: 8,
            }) }));
        }
    }

    close(): void { this.readyState = 3; }

    private emit(type: string, event: { data?: string }): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
}

describe('relay admission transport', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('solves a relay challenge and retries the namespace request', async () => {
        let socket: AdmissionWebSocket | undefined;
        class CapturedWebSocket extends AdmissionWebSocket {
            constructor(url: string) { super(url); socket = this; }
        }
        vi.stubGlobal('WebSocket', CapturedWebSocket);
        const groupId = '00000000-0000-4000-8000-000000000001';
        const transport = new RelayTransport({
            url: 'wss://relay.example/ws',
            groupCapabilities: { [groupId]: 'A'.repeat(43) },
        });
        await transport.connect(groupId as never);
        await vi.waitFor(() => {
            expect(socket?.sent.some((message) => message['type'] === 'SUBSCRIBE' && typeof message['admissionProof'] === 'string')).toBe(true);
        });
        await transport.disconnectAll();
    });
});
