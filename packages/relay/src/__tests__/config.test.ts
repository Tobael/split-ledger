import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

describe('relay configuration', () => {
    it('keeps ciphertext indefinitely unless retention is explicitly enabled', () => {
        expect(loadConfig({}).operationRetentionDays).toBe(0);
        expect(loadConfig({ OPERATION_RETENTION_DAYS: '30' }).operationRetentionDays).toBe(30);
    });

    it('bounds opaque storage and WebSocket messages by default', () => {
        const config = loadConfig({});
        expect(config.maxGroupStorageBytes).toBe(64 * 1024 * 1024);
        expect(config.maxTotalStorageBytes).toBe(1024 * 1024 * 1024);
        expect(config.maxNamespaces).toBe(10000);
        expect(config.maxWsMessageSizeBytes).toBe(128 * 1024);
        expect(config.maxNamespaceCreationsPerIpPerMinute).toBe(30);
        expect(config.maxPublishesPerIpPerMinute).toBe(3000);
        expect(config.maxUploadBytesPerIpPerMinute).toBe(16 * 1024 * 1024);
    });

    it('rejects malformed and unsafe numeric settings', () => {
        expect(() => loadConfig({ PAGE_SIZE: 'many' })).toThrow(/PAGE_SIZE/);
        expect(() => loadConfig({ MAX_CONNECTIONS_PER_IP: '0' })).toThrow(/MAX_CONNECTIONS_PER_IP/);
        expect(() => loadConfig({ OPERATION_RETENTION_DAYS: '-1' })).toThrow(/OPERATION_RETENTION_DAYS/);
        expect(() => loadConfig({ TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
    });
});
