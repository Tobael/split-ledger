// =============================================================================
// Relay Server Integration Tests
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay, type RelayServer } from '../server.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Helpers ───

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
        ws.once('open', resolve);
        ws.once('error', reject);
    });
}

function waitForMessage<T = unknown>(ws: WebSocket, timeout = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
        ws.once('message', (data) => {
            clearTimeout(timer);
            resolve(JSON.parse(data.toString()) as T);
        });
    });
}

function sendJson(ws: WebSocket, msg: unknown): void {
    ws.send(JSON.stringify(msg));
}

// ─── Tests ───

describe('Relay Server', () => {
    let relay: RelayServer;
    let baseUrl: string;
    let wsUrl: string;

    beforeAll(async () => {
        const dbPath = join(tmpdir(), `relay-test-${randomUUID()}.db`);
        relay = startRelay({ port: 0, dbPath }); // port 0 = random available port
        // Wait a bit for server to start
        await new Promise((r) => setTimeout(r, 500));
        const addr = relay.address();
        baseUrl = `http://${addr.host === '0.0.0.0' ? '127.0.0.1' : addr.host}:${addr.port}`;
        wsUrl = `ws://${addr.host === '0.0.0.0' ? '127.0.0.1' : addr.host}:${addr.port}`;
    });

    afterAll(async () => {
        await relay.close();
    });

    describe('REST API', () => {
        it('GET /api/v1/health returns OK', async () => {
            const res = await fetch(`${baseUrl}/api/v1/health`);
            expect(res.status).toBe(200);
            const body = await res.json() as { status: string };
            expect(body.status).toBe('ok');
        });

        it('invite CRUD lifecycle', async () => {
            // Create
            const res = await fetch(`${baseUrl}/api/v1/invites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    groupId: randomUUID(),
                    inviteData: Buffer.from('test-invite').toString('base64'),
                    expiresAt: new Date(Date.now() + 86400000).toISOString(),
                    creatorPubkey: 'abc123',
                }),
            });
            expect(res.status).toBe(201);
            const created = await res.json() as { inviteId: string };
            expect(created.inviteId).toBeTruthy();

            // Read
            const getRes = await fetch(`${baseUrl}/api/v1/invites/${created.inviteId}`);
            expect(getRes.status).toBe(200);
            const invite = await getRes.json() as { inviteData: string };
            expect(Buffer.from(invite.inviteData, 'base64').toString()).toBe('test-invite');

            // Delete (unauthorized)
            const delResFail = await fetch(`${baseUrl}/api/v1/invites/${created.inviteId}`, {
                method: 'DELETE',
                headers: { 'x-creator-pubkey': 'wrong-key' },
            });
            expect(delResFail.status).toBe(404);

            // Delete (authorized)
            const delRes = await fetch(`${baseUrl}/api/v1/invites/${created.inviteId}`, {
                method: 'DELETE',
                headers: { 'x-creator-pubkey': 'abc123' },
            });
            expect(delRes.status).toBe(200);

            // Verify deleted
            const gone = await fetch(`${baseUrl}/api/v1/invites/${created.inviteId}`);
            expect(gone.status).toBe(404);
        });

        it('returns 410 for expired invite', async () => {
            const res = await fetch(`${baseUrl}/api/v1/invites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    groupId: randomUUID(),
                    inviteData: Buffer.from('expired').toString('base64'),
                    expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
                    creatorPubkey: 'abc123',
                }),
            });
            const created = await res.json() as { inviteId: string };

            const getRes = await fetch(`${baseUrl}/api/v1/invites/${created.inviteId}`);
            expect(getRes.status).toBe(410);
        });
    });

    describe('WebSocket Protocol', () => {
        it('PING/PONG', async () => {
            const groupId = randomUUID();
            const ws = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(ws);

            const pongPromise = waitForMessage(ws);
            sendJson(ws, { type: 'PING' });
            const pong = await pongPromise as { type: string };
            expect(pong.type).toBe('PONG');

            ws.close();
        });

        it('PUBLISH_ENTRY + broadcast to subscriber', async () => {
            const groupId = randomUUID();
            const entryData = Buffer.from('encrypted-entry-data').toString('base64');

            // Client A subscribes
            const clientA = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(clientA);

            // Client B subscribes
            const clientB = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(clientB);

            // Client A publishes
            const entryPromise = waitForMessage(clientB);
            sendJson(clientA, {
                type: 'PUBLISH_ENTRY',
                groupId,
                lamportClock: 0,
                senderPubkey: 'sender-abc',
                encryptedEntry: entryData,
            });

            // Client B should receive NEW_ENTRY
            const received = await entryPromise as { type: string; encryptedEntry: string; lamportClock: number };
            expect(received.type).toBe('NEW_ENTRY');
            expect(received.encryptedEntry).toBe(entryData);
            expect(received.lamportClock).toBe(0);

            clientA.close();
            clientB.close();
        });

        it('GET_ENTRIES_AFTER returns stored entries', async () => {
            const groupId = randomUUID();
            const ws = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(ws);

            // Publish 3 entries
            for (let i = 0; i < 3; i++) {
                sendJson(ws, {
                    type: 'PUBLISH_ENTRY',
                    groupId,
                    lamportClock: i,
                    senderPubkey: 'sender',
                    encryptedEntry: Buffer.from(`entry-${i}`).toString('base64'),
                });
            }

            // Wait for entries to be stored
            await new Promise((r) => setTimeout(r, 200));

            // Request entries after clock 0
            const responsePromise = waitForMessage(ws);
            sendJson(ws, { type: 'GET_ENTRIES_AFTER', groupId, afterLamportClock: 0 });
            const response = await responsePromise as { type: string; entries: Array<{ lamportClock: number }> };

            expect(response.type).toBe('ENTRIES_RESPONSE');
            expect(response.entries.length).toBe(2); // clocks 1 and 2
            expect(response.entries.every((e) => e.lamportClock > 0)).toBe(true);

            ws.close();
        });

        it('GET_FULL_LEDGER returns all entries', async () => {
            const groupId = randomUUID();
            const ws = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(ws);

            // Publish entries
            for (let i = 0; i < 3; i++) {
                sendJson(ws, {
                    type: 'PUBLISH_ENTRY',
                    groupId,
                    lamportClock: i,
                    senderPubkey: 'sender',
                    encryptedEntry: Buffer.from(`entry-${i}`).toString('base64'),
                });
            }
            await new Promise((r) => setTimeout(r, 200));

            const responsePromise = waitForMessage(ws);
            sendJson(ws, { type: 'GET_FULL_LEDGER', groupId });
            const response = await responsePromise as { type: string; entries: unknown[] };

            expect(response.type).toBe('FULL_LEDGER');
            expect(response.entries.length).toBe(3);

            ws.close();
        });

        it('duplicate entries are ignored (idempotent)', async () => {
            const groupId = randomUUID();
            const ws = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(ws);

            const entry = {
                type: 'PUBLISH_ENTRY',
                groupId,
                lamportClock: 0,
                senderPubkey: 'sender',
                encryptedEntry: Buffer.from('same-entry').toString('base64'),
            };

            // Publish same entry twice
            sendJson(ws, entry);
            sendJson(ws, entry);
            await new Promise((r) => setTimeout(r, 200));

            const responsePromise = waitForMessage(ws);
            sendJson(ws, { type: 'GET_FULL_LEDGER', groupId });
            const response = await responsePromise as { type: string; entries: unknown[] };
            expect(response.entries.length).toBe(1); // only stored once

            ws.close();
        });

        it('peers endpoint shows connected count', async () => {
            const groupId = randomUUID();
            const ws1 = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            const ws2 = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(ws1);
            await waitForOpen(ws2);

            const res = await fetch(`${baseUrl}/api/v1/groups/${groupId}/peers`);
            const body = await res.json() as { connectedPeers: number };
            expect(body.connectedPeers).toBe(2);

            ws1.close();
            ws2.close();
        });

        it('SIGNAL_OFFER is forwarded to target peer', async () => {
            const groupId = randomUUID();

            // Both peers connect
            const peerA = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            const peerB = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(peerA);
            await waitForOpen(peerB);

            // Peer B registers its identity by sending a signal first
            // (any signal from B registers B's peerId)
            sendJson(peerB, {
                type: 'SIGNAL_OFFER',
                groupId,
                fromPeerId: 'peer-b-id',
                toPeerId: 'nonexistent', // goes nowhere
                sdp: 'dummy',
            });
            await new Promise((r) => setTimeout(r, 100));

            // Peer A sends an offer to peer B
            const msgPromise = waitForMessage(peerB);
            sendJson(peerA, {
                type: 'SIGNAL_OFFER',
                groupId,
                fromPeerId: 'peer-a-id',
                toPeerId: 'peer-b-id',
                sdp: 'offer-sdp-data',
            });

            const received = await msgPromise as { type: string; fromPeerId: string; sdp: string };
            expect(received.type).toBe('SIGNAL_OFFER');
            expect(received.fromPeerId).toBe('peer-a-id');
            expect(received.sdp).toBe('offer-sdp-data');

            peerA.close();
            peerB.close();
        });

        it('SIGNAL_ANSWER is forwarded to target peer', async () => {
            const groupId = randomUUID();

            const peerA = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            const peerB = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(peerA);
            await waitForOpen(peerB);

            // Register peer A
            sendJson(peerA, {
                type: 'SIGNAL_OFFER',
                groupId,
                fromPeerId: 'peer-a-id',
                toPeerId: 'nonexistent',
                sdp: 'dummy',
            });
            await new Promise((r) => setTimeout(r, 100));

            // Peer B sends answer to peer A
            const msgPromise = waitForMessage(peerA);
            sendJson(peerB, {
                type: 'SIGNAL_ANSWER',
                groupId,
                fromPeerId: 'peer-b-id',
                toPeerId: 'peer-a-id',
                sdp: 'answer-sdp-data',
            });

            const received = await msgPromise as { type: string; fromPeerId: string; sdp: string };
            expect(received.type).toBe('SIGNAL_ANSWER');
            expect(received.fromPeerId).toBe('peer-b-id');
            expect(received.sdp).toBe('answer-sdp-data');

            peerA.close();
            peerB.close();
        });

        it('signal to unknown peer is silently dropped', async () => {
            const groupId = randomUUID();
            const ws = new WebSocket(`${wsUrl}?groupId=${groupId}`);
            await waitForOpen(ws);

            // Should not throw or produce an error response
            sendJson(ws, {
                type: 'SIGNAL_OFFER',
                groupId,
                fromPeerId: 'peer-a',
                toPeerId: 'unknown-peer',
                sdp: 'test',
            });

            // PING/PONG to verify connection still works
            const pongPromise = waitForMessage(ws);
            sendJson(ws, { type: 'PING' });
            const pong = await pongPromise as { type: string };
            expect(pong.type).toBe('PONG');

            ws.close();
        });
    });
});
