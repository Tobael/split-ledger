// =============================================================================
// SplitLedger Relay — Server Entry Point
// =============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { loadConfig, type RelayConfig } from './config.js';
import { RelayDatabase } from './db.js';
import { createRestApi } from './rest-api.js';
import { createWsHandler, RoomManager } from './ws-handler.js';

export interface RelayServer {
    close(): Promise<void>;
    config: RelayConfig;
    address(): { port: number; host: string };
}

/**
 * Create and start the relay server.
 * Returns a handle to close it (for testing).
 */
export function startRelay(configOverrides?: Partial<RelayConfig>): RelayServer {
    const config = { ...loadConfig(), ...configOverrides };
    const db = new RelayDatabase(config.dbPath);
    const rooms = new RoomManager();

    // Hono app for REST
    const app = createRestApi(db, rooms);

    // Node HTTP server — dispatches REST to Hono, WS via upgrade
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
            // Convert Node req to a Web Request for Hono
            const protocol = 'http';
            const host = req.headers.host ?? `localhost:${config.port}`;
            const url = `${protocol}://${host}${req.url ?? '/'}`;

            // Read the body (only for methods that have one)
            let body: Buffer | undefined;
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                const chunks: Buffer[] = [];
                for await (const chunk of req) {
                    chunks.push(chunk as Buffer);
                }
                body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
            }

            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
                if (value) {
                    if (Array.isArray(value)) {
                        for (const v of value) headers.append(key, v);
                    } else {
                        headers.set(key, value);
                    }
                }
            }

            const webRequest = new Request(url, {
                method: req.method,
                headers,
                body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
            });

            const webResponse = await app.fetch(webRequest);

            // Convert Web Response back to Node res
            res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
            const responseBody = await webResponse.arrayBuffer();
            res.end(Buffer.from(responseBody));
        } catch (err) {
            res.writeHead(500);
            res.end('Internal Server Error');
        }
    });

    // WebSocket server on same HTTP server
    const wss = new WebSocketServer({ server: httpServer });
    const wsHandler = createWsHandler(db, config, rooms);
    const connectionsByIp = new Map<string, number>();
    wss.on('connection', (ws, req) => {
        const forwarded = req.headers['x-forwarded-for'];
        const ip = config.trustProxy && typeof forwarded === 'string'
            ? (forwarded.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown')
            : (req.socket.remoteAddress ?? 'unknown');
        const count = connectionsByIp.get(ip) ?? 0;
        if (count >= config.maxConnectionsPerIp) {
            ws.close(1013, 'Connection limit exceeded');
            return;
        }
        connectionsByIp.set(ip, count + 1);
        ws.once('close', () => {
            const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
            if (remaining > 0) connectionsByIp.set(ip, remaining);
            else connectionsByIp.delete(ip);
        });
        wsHandler(ws, req);
    });

    // Start listening
    httpServer.listen(config.port, config.host);

    // Periodic maintenance
    const pruneInterval = config.operationRetentionDays > 0
        ? setInterval(() => {
            db.pruneOldOperations(config.operationRetentionDays);
        }, 60 * 60 * 1000)
        : null;

    return {
        config,
        address() {
            const addr = httpServer.address();
            if (typeof addr === 'string' || addr === null) {
                return { port: config.port, host: config.host };
            }
            return { port: addr.port, host: addr.address };
        },
        async close() {
            if (pruneInterval) clearInterval(pruneInterval);
            // Close all WebSocket connections
            for (const client of wss.clients) {
                client.close(1000, 'Server shutting down');
            }
            wss.close();
            await new Promise<void>((resolve, reject) => {
                httpServer.close((err) => (err ? reject(err) : resolve()));
            });
            db.close();
        },
    };
}

// ─── CLI entry point ───
const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
    const relay = startRelay();
    const addr = relay.address();
    console.log(`SplitLedger Relay listening on ${addr.host}:${addr.port}`);
    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('Shutting down...');
        await relay.close();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
