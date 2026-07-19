import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay, type RelayServer } from '../server.js';

const capability = 'A'.repeat(43);
const wrongCapability = 'B'.repeat(43);
const groupId = () => randomUUID();
const operationId = () => randomBytes(32).toString('hex');
const encrypted = (value: string) => Buffer.from(value).toString('base64');
function waitForOpen(ws: WebSocket): Promise<void> { return new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }); }
function waitForMessage<T>(ws: WebSocket): Promise<T> { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Timeout')), 3000); ws.once('message', (data) => { clearTimeout(timer); resolve(JSON.parse(data.toString()) as T); }); }); }
function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Timeout')), 3000); ws.once('close', (code, reason) => { clearTimeout(timer); resolve({ code, reason: reason.toString() }); }); }); }
function send(ws: WebSocket, message: unknown): void { ws.send(JSON.stringify(message)); }
async function wsAddress(relay: RelayServer): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const address = relay.address();
    const host = address.host === '0.0.0.0' ? '127.0.0.1' : address.host;
    return `ws://${host}:${address.port}`;
}

describe('protocol v2 relay', () => {
    let relay: RelayServer;
    let baseUrl: string;
    let wsUrl: string;
    beforeAll(async () => {
        relay = startRelay({ port: 0, dbPath: join(tmpdir(), `relay-${randomUUID()}.db`), pageSize: 2 });
        await new Promise((resolve) => setTimeout(resolve, 300));
        const address = relay.address();
        const host = address.host === '0.0.0.0' ? '127.0.0.1' : address.host;
        baseUrl = `http://${host}:${address.port}`; wsUrl = `ws://${host}:${address.port}`;
    });
    afterAll(async () => relay.close());

    it('reports health', async () => { expect((await fetch(`${baseUrl}/api/v2/health`)).status).toBe(200); });
    it('answers PING without group authorization', async () => {
        const ws = new WebSocket(wsUrl); await waitForOpen(ws); const response = waitForMessage<{ type: string }>(ws); send(ws, { type: 'PING' }); expect((await response).type).toBe('PONG'); ws.close();
    });
    it('registers an empty group on first capability use and rejects a different capability', async () => {
        const id = groupId(); const ws = new WebSocket(wsUrl); await waitForOpen(ws);
        const registered = waitForMessage<{ type: string; operations: unknown[] }>(ws); send(ws, { type: 'GET_OPERATIONS', groupId: id, capability, cursor: 0 });
        expect((await registered).operations).toEqual([]);
        const rejected = waitForMessage<{ code: string }>(ws); send(ws, { type: 'SUBSCRIBE', groupId: id, capability: wrongCapability });
        expect((await rejected).code).toBe('UNAUTHORIZED'); ws.close();
    });
    it('publishes and broadcasts authenticated operation envelopes', async () => {
        const id = groupId(); const op = operationId(); const publisher = new WebSocket(wsUrl); const subscriber = new WebSocket(wsUrl);
        await Promise.all([waitForOpen(publisher), waitForOpen(subscriber)]);
        send(publisher, { type: 'PUBLISH_OPERATION', groupId: id, capability, operationId: op, encryptedOperation: encrypted('root') });
        await new Promise((resolve) => setTimeout(resolve, 30)); send(subscriber, { type: 'SUBSCRIBE', groupId: id, capability });
        await new Promise((resolve) => setTimeout(resolve, 30)); const incoming = waitForMessage<{ type: string; operationId: string }>(subscriber);
        send(publisher, { type: 'PUBLISH_OPERATION', groupId: id, capability, operationId: operationId(), encryptedOperation: encrypted('next') });
        expect((await incoming).type).toBe('OPERATION'); publisher.close(); subscriber.close();
    });
    it('deduplicates by operation ID and paginates by opaque cursor', async () => {
        const id = groupId(); const ws = new WebSocket(wsUrl); await waitForOpen(ws); const ids = [operationId(), operationId(), operationId()];
        for (const op of [...ids, ids[0]!]) send(ws, { type: 'PUBLISH_OPERATION', groupId: id, capability, operationId: op, encryptedOperation: encrypted(op) });
        await new Promise((resolve) => setTimeout(resolve, 80));
        const firstResponse = waitForMessage<{ operations: Array<{ cursor: number; operationId: string }>; nextCursor: number; hasMore: boolean }>(ws);
        send(ws, { type: 'GET_OPERATIONS', groupId: id, capability, cursor: 0 }); const first = await firstResponse;
        expect(first.operations).toHaveLength(2); expect(first.hasMore).toBe(true);
        const secondResponse = waitForMessage<{ operations: unknown[]; hasMore: boolean }>(ws); send(ws, { type: 'GET_OPERATIONS', groupId: id, capability, cursor: first.nextCursor });
        const second = await secondResponse; expect(second.operations).toHaveLength(1); expect(second.hasMore).toBe(false); ws.close();
    });
    it('rejects reads using the wrong capability', async () => {
        const id = groupId(); const ws = new WebSocket(wsUrl); await waitForOpen(ws); send(ws, { type: 'PUBLISH_OPERATION', groupId: id, capability, operationId: operationId(), encryptedOperation: encrypted('root') });
        await new Promise((resolve) => setTimeout(resolve, 30)); const response = waitForMessage<{ code: string }>(ws); send(ws, { type: 'GET_OPERATIONS', groupId: id, capability: wrongCapability, cursor: 0 }); expect((await response).code).toBe('UNAUTHORIZED'); ws.close();
    });
    it('atomically consumes a disposable namespace and rejects replay', async () => {
        const id = groupId(); const ws = new WebSocket(wsUrl); await waitForOpen(ws); const op = operationId();
        send(ws, { type: 'PUBLISH_DISPOSABLE', groupId: id, capability, operationId: op, encryptedOperation: encrypted('transfer') });
        await new Promise((resolve) => setTimeout(resolve, 30));
        const rejected = waitForMessage<{ code: string }>(ws); send(ws, { type: 'CONSUME_OPERATIONS', groupId: id, capability: wrongCapability });
        expect((await rejected).code).toBe('UNAUTHORIZED');
        const consumed = waitForMessage<{ type: string; operations: Array<{ operationId: string }> }>(ws); send(ws, { type: 'CONSUME_OPERATIONS', groupId: id, capability });
        expect(await consumed).toMatchObject({ type: 'OPERATIONS_CONSUMED', operations: [{ operationId: op }] });
        const replay = waitForMessage<{ code: string }>(ws); send(ws, { type: 'CONSUME_OPERATIONS', groupId: id, capability });
        expect((await replay).code).toBe('UNAUTHORIZED'); ws.close();
    });
    it('never consumes a normal group namespace', async () => {
        const id = groupId(); const ws = new WebSocket(wsUrl); await waitForOpen(ws);
        send(ws, { type: 'PUBLISH_OPERATION', groupId: id, capability, operationId: operationId(), encryptedOperation: encrypted('group') });
        await new Promise((resolve) => setTimeout(resolve, 30));
        const response = waitForMessage<{ code: string }>(ws); send(ws, { type: 'CONSUME_OPERATIONS', groupId: id, capability });
        expect((await response).code).toBe('UNAUTHORIZED'); ws.close();
    });
    it('enforces the configured connection limit per client IP', async () => {
        const limited = startRelay({
            port: 0,
            dbPath: join(tmpdir(), `relay-${randomUUID()}.db`),
            maxConnectionsPerIp: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const address = limited.address();
        const host = address.host === '0.0.0.0' ? '127.0.0.1' : address.host;
        const first = new WebSocket(`ws://${host}:${address.port}`);
        await waitForOpen(first);
        const second = new WebSocket(`ws://${host}:${address.port}`);
        const closed = waitForClose(second);
        await waitForOpen(second);
        expect(await closed).toEqual({ code: 1013, reason: 'Connection limit exceeded' });
        first.close();
        await limited.close();
    });
    it('accepts idempotent republication after a group reaches its quota', async () => {
        const quotaRelay = startRelay({
            port: 0,
            dbPath: join(tmpdir(), `relay-${randomUUID()}.db`),
            maxOperationsPerGroup: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const address = quotaRelay.address();
        const host = address.host === '0.0.0.0' ? '127.0.0.1' : address.host;
        const ws = new WebSocket(`ws://${host}:${address.port}`);
        await waitForOpen(ws);
        const id = groupId();
        const op = operationId();
        send(ws, { type: 'PUBLISH_OPERATION', groupId: id, capability, operationId: op, encryptedOperation: encrypted('root') });
        await new Promise((resolve) => setTimeout(resolve, 30));
        send(ws, { type: 'PUBLISH_OPERATION', groupId: id, capability, operationId: op, encryptedOperation: encrypted('root') });
        await new Promise((resolve) => setTimeout(resolve, 30));
        const response = waitForMessage<{ operations: unknown[] }>(ws);
        send(ws, { type: 'GET_OPERATIONS', groupId: id, capability, cursor: 0 });
        expect((await response).operations).toHaveLength(1);
        ws.close();
        await quotaRelay.close();
    });
    it('bounds stored ciphertext per group and across the relay', async () => {
        const quotaRelay = startRelay({
            port: 0,
            dbPath: join(tmpdir(), `relay-${randomUUID()}.db`),
            maxGroupStorageBytes: 5,
            maxTotalStorageBytes: 8,
        });
        const ws = new WebSocket(await wsAddress(quotaRelay));
        await waitForOpen(ws);
        const firstGroup = groupId();
        send(ws, { type: 'PUBLISH_OPERATION', groupId: firstGroup, capability, operationId: operationId(), encryptedOperation: encrypted('1234') });
        await new Promise((resolve) => setTimeout(resolve, 30));
        const groupFull = waitForMessage<{ code: string }>(ws);
        send(ws, { type: 'PUBLISH_OPERATION', groupId: firstGroup, capability, operationId: operationId(), encryptedOperation: encrypted('12') });
        expect((await groupFull).code).toBe('GROUP_STORAGE_FULL');

        const secondGroup = groupId();
        send(ws, { type: 'PUBLISH_OPERATION', groupId: secondGroup, capability, operationId: operationId(), encryptedOperation: encrypted('1234') });
        await new Promise((resolve) => setTimeout(resolve, 30));
        const relayFull = waitForMessage<{ code: string }>(ws);
        send(ws, { type: 'PUBLISH_OPERATION', groupId: secondGroup, capability, operationId: operationId(), encryptedOperation: encrypted('1') });
        expect((await relayFull).code).toBe('RELAY_STORAGE_FULL');
        ws.close();
        await quotaRelay.close();
    });
    it('bounds the number of attacker-created namespaces', async () => {
        const quotaRelay = startRelay({
            port: 0,
            dbPath: join(tmpdir(), `relay-${randomUUID()}.db`),
            maxNamespaces: 1,
        });
        const ws = new WebSocket(await wsAddress(quotaRelay));
        await waitForOpen(ws);
        const registered = waitForMessage<{ type: string }>(ws);
        send(ws, { type: 'GET_OPERATIONS', groupId: groupId(), capability, cursor: 0 });
        expect((await registered).type).toBe('OPERATIONS_RESPONSE');
        const full = waitForMessage<{ code: string }>(ws);
        send(ws, { type: 'GET_OPERATIONS', groupId: groupId(), capability, cursor: 0 });
        expect((await full).code).toBe('RELAY_FULL');
        ws.close();
        await quotaRelay.close();
    });
    it('shares namespace creation limits across connections from one IP', async () => {
        const quotaRelay = startRelay({
            port: 0,
            dbPath: join(tmpdir(), `relay-${randomUUID()}.db`),
            maxNamespaceCreationsPerIpPerMinute: 1,
        });
        const url = await wsAddress(quotaRelay);
        const first = new WebSocket(url);
        const second = new WebSocket(url);
        await Promise.all([waitForOpen(first), waitForOpen(second)]);
        const registered = waitForMessage<{ type: string }>(first);
        send(first, { type: 'GET_OPERATIONS', groupId: groupId(), capability, cursor: 0 });
        expect((await registered).type).toBe('OPERATIONS_RESPONSE');
        const limited = waitForMessage<{ code: string }>(second);
        send(second, { type: 'GET_OPERATIONS', groupId: groupId(), capability, cursor: 0 });
        expect((await limited).code).toBe('RATE_LIMITED');
        first.close(); second.close();
        await quotaRelay.close();
    });
    it('recovers an empty replacement relay from one member durable operation set', async () => {
        const id = groupId();
        const localOperations = ['root', 'expense-a', 'expense-b'].map((value) => ({
            operationId: operationId(),
            encryptedOperation: encrypted(value),
        }));
        const original = startRelay({ port: 0, dbPath: join(tmpdir(), `relay-${randomUUID()}.db`) });
        const originalMember = new WebSocket(await wsAddress(original));
        await waitForOpen(originalMember);
        for (const operation of localOperations) {
            send(originalMember, { type: 'PUBLISH_OPERATION', groupId: id, capability, ...operation });
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        const originalClosed = waitForClose(originalMember);
        originalMember.close();
        await originalClosed;
        await original.close();

        const replacement = startRelay({ port: 0, dbPath: join(tmpdir(), `relay-${randomUUID()}.db`) });
        const replacementUrl = await wsAddress(replacement);
        const seedingMember = new WebSocket(replacementUrl);
        const recoveringMember = new WebSocket(replacementUrl);
        await Promise.all([waitForOpen(seedingMember), waitForOpen(recoveringMember)]);
        for (const operation of localOperations) {
            send(seedingMember, { type: 'PUBLISH_OPERATION', groupId: id, capability, ...operation });
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        const response = waitForMessage<{ operations: Array<{ operationId: string }> }>(recoveringMember);
        send(recoveringMember, { type: 'GET_OPERATIONS', groupId: id, capability, cursor: 0 });

        expect((await response).operations.map(({ operationId: value }) => value)).toEqual(
            localOperations.map(({ operationId: value }) => value),
        );
        const seedingClosed = waitForClose(seedingMember);
        const recoveringClosed = waitForClose(recoveringMember);
        seedingMember.close();
        recoveringMember.close();
        await Promise.all([seedingClosed, recoveringClosed]);
        await replacement.close();
    });
});
