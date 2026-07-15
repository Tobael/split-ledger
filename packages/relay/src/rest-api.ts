// =============================================================================
// SplitLedger Relay — REST API (Hono)
// =============================================================================

import { Hono } from 'hono';
import type { RelayDatabase } from './db.js';
import type { RoomManager } from './ws-handler.js';

export function createRestApi(db: RelayDatabase, rooms: RoomManager): Hono {
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

    return app;
}
