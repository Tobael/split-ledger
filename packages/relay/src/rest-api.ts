// =============================================================================
// SplitLedger Relay — REST API (Hono)
// =============================================================================

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { RelayDatabase } from './db.js';
import type { RoomManager } from './ws-handler.js';

export function createRestApi(db: RelayDatabase, rooms: RoomManager): Hono {
    const app = new Hono();

    // ─── Health ───

    app.get('/api/v1/health', (c) => {
        return c.json({
            status: 'ok',
            version: '0.1.0',
            connectedPeers: rooms.getTotalConnections(),
            groups: db.getGroupCount(),
        });
    });

    // ─── Invites ───

    app.post('/api/v1/invites', async (c) => {
        const body = await c.req.json<{
            groupId: string;
            inviteData: string; // base64
            expiresAt: string | number;
            creatorPubkey: string;
        }>();

        if (!body.groupId || !body.inviteData || !body.expiresAt || !body.creatorPubkey) {
            return c.json({ error: 'Missing required fields' }, 400);
        }

        const inviteId = uuidv4();
        const inviteData = Buffer.from(body.inviteData, 'base64');
        const expiresAt = new Date(body.expiresAt);

        if (isNaN(expiresAt.getTime())) {
            return c.json({ error: 'Invalid expiresAt date' }, 400);
        }

        db.storeInvite(inviteId, body.groupId, inviteData, body.creatorPubkey, expiresAt);

        return c.json({
            inviteId,
            shortUrl: `/join/${inviteId}`,
        }, 201);
    });

    app.get('/api/v1/invites/:inviteId', (c) => {
        const invite = db.getInvite(c.req.param('inviteId'));
        if (!invite) {
            return c.json({ error: 'Invite not found' }, 404);
        }

        // Check expiry
        if (new Date(invite.expiresAt) < new Date()) {
            return c.json({ error: 'Invite has expired' }, 410);
        }

        return c.json({
            groupId: invite.groupId,
            inviteData: (invite.inviteData as unknown as Buffer).toString('base64'),
            expiresAt: invite.expiresAt,
        });
    });

    app.delete('/api/v1/invites/:inviteId', async (c) => {
        const creatorPubkey = c.req.header('x-creator-pubkey');
        if (!creatorPubkey) {
            return c.json({ error: 'Missing x-creator-pubkey header' }, 401);
        }

        const deleted = db.deleteInvite(c.req.param('inviteId'), creatorPubkey);
        if (!deleted) {
            return c.json({ error: 'Invite not found or unauthorized' }, 404);
        }

        return c.json({ deleted: true });
    });

    // ─── Group Peers ───

    app.get('/api/v1/groups/:groupId/peers', (c) => {
        const groupId = c.req.param('groupId');
        const count = rooms.getSubscriberCount(groupId);
        return c.json({
            groupId,
            connectedPeers: count,
        });
    });

    return app;
}
