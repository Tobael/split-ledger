import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

describe('relay configuration', () => {
    it('keeps ciphertext indefinitely unless retention is explicitly enabled', () => {
        expect(loadConfig({}).operationRetentionDays).toBe(0);
        expect(loadConfig({ OPERATION_RETENTION_DAYS: '30' }).operationRetentionDays).toBe(30);
    });

    it('rejects malformed and unsafe numeric settings', () => {
        expect(() => loadConfig({ PAGE_SIZE: 'many' })).toThrow(/PAGE_SIZE/);
        expect(() => loadConfig({ MAX_CONNECTIONS_PER_IP: '0' })).toThrow(/MAX_CONNECTIONS_PER_IP/);
        expect(() => loadConfig({ OPERATION_RETENTION_DAYS: '-1' })).toThrow(/OPERATION_RETENTION_DAYS/);
        expect(() => loadConfig({ TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
    });
});
