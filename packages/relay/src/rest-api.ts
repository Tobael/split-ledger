// =============================================================================
// SplitLedger Relay — REST API (Hono)
// =============================================================================

import { Hono } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RelayConfig } from './config.js';
import type { RelayDatabase } from './db.js';
import type { RoomManager } from './ws-handler.js';

function tokenMatches(provided: string | undefined, expected: string): boolean {
    if (!provided?.startsWith('Bearer ')) return false;
    const suppliedHash = createHash('sha256').update(provided.slice(7)).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    return timingSafeEqual(suppliedHash, expectedHash);
}

export function createRestApi(db: RelayDatabase, rooms: RoomManager, config: RelayConfig): Hono {
    const app = new Hono();

    // ─── Health ───

    app.get('/api/v2/health', (c) => {
        return c.json({
            status: 'ok',
            version: '0.1.0',
            connectedPeers: rooms.getTotalConnections(),
            groups: db.getGroupCount(),
        });
    });

    app.use('/api/v2/admin/*', async (c, next) => {
        if (!config.adminToken) return c.json({ error: 'Not found' }, 404);
        if (!tokenMatches(c.req.header('authorization'), config.adminToken)) {
            return c.json({ error: 'Unauthorized' }, 401);
        }
        await next();
    });

    app.get('/api/v2/admin/storage', (c) => {
        const requestedLimit = Number(c.req.query('limit') ?? 25);
        const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 25;
        return c.json({
            storedBytes: db.getTotalStoredBytes(),
            maxStoredBytes: config.maxTotalStorageBytes,
            operationCount: db.getTotalOperationCount(),
            namespaceCount: db.getNamespaceCount(),
            maxNamespaces: config.maxNamespaces,
            namespaces: db.listNamespaceUsage(limit),
        });
    });

    app.delete('/api/v2/admin/namespaces/:groupId', (c) => {
        if (!db.deleteNamespace(c.req.param('groupId'))) return c.json({ error: 'Not found' }, 404);
        return c.body(null, 204);
    });

    return app;
}
