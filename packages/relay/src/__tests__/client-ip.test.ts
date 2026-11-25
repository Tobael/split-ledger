import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { clientIp } from '../client-ip.js';

const cloudflare = { trustProxy: true, trustProxyClientIpHeader: 'cf-connecting-ip' } as const;
const request = (headers: IncomingMessage['headers']) => ({ headers, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage);

describe('proxy visitor identity', () => {
    it('ignores a forged X-Forwarded-For chain in Cloudflare mode', () => {
        expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': '198.51.100.2, 173.245.48.1' }), cloudflare)).toBe('203.0.113.1');
        expect(clientIp(request({ 'cf-connecting-ip': '2001:db8::1' }), cloudflare)).toBe('2001:db8::1');
    });
    it('rejects lists and duplicate Cloudflare header values', () => {
        expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.1, 198.51.100.2' }), cloudflare)).toBe('unknown');
        expect(clientIp(request({ 'cf-connecting-ip': ['203.0.113.1', '198.51.100.2'] }), cloudflare)).toBe('127.0.0.1');
    });
    it('ignores headers for a directly exposed relay', () => {
        expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.1' }), { ...cloudflare, trustProxy: false })).toBe('127.0.0.1');
    });
    it('supports a proxy that replaces the forwarded chain', () => {
        expect(clientIp(request({ 'x-forwarded-for': '203.0.113.1, 127.0.0.1' }), { trustProxy: true, trustProxyClientIpHeader: 'x-forwarded-for' })).toBe('203.0.113.1');
    });
});
