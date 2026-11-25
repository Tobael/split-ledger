import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { RelayConfig } from './config.js';

// Only trust a header when the relay is inaccessible except through the proxy.
// The homelab router verifies Cloudflare peers before forwarding its IP header.
export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>, config: Pick<RelayConfig, 'trustProxy' | 'trustProxyClientIpHeader'>): string {
    if (!config.trustProxy) return req.socket.remoteAddress ?? 'unknown';
    const forwarded = req.headers[config.trustProxyClientIpHeader];
    if (typeof forwarded !== 'string') return req.socket.remoteAddress ?? 'unknown';
    const ip = config.trustProxyClientIpHeader === 'x-forwarded-for'
        ? forwarded.split(',')[0]?.trim() ?? ''
        : forwarded.trim();
    return isIP(ip) ? ip : 'unknown';
}
