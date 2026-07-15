import { describe, expect, it } from 'vitest';

import {
    createInviteV2,
    parseInviteV2,
    type InvitePayloadV2,
} from '../protocol-v2/index.js';

const payload: InvitePayloadV2 = {
    protocolVersion: 2,
    groupId: '018cc251-f400-7000-8000-000000000001',
    relayUrl: 'wss://relay.example/sync',
    relayGroupCapability: 'A'.repeat(43),
    groupSecret: 'B'.repeat(43),
    scope: 'targeted',
    participantId: '018cc251-f400-7000-8000-000000000003',
    capabilityId: '018cc251-f400-7000-8000-000000000004',
    claimSecret: 'C'.repeat(43),
    issueOperationId: 'd'.repeat(64),
    displayExpiresAt: 1767830400000,
};

describe('protocol v2 encrypted invitations', () => {
    it('round-trips a strictly validated invite through its HTTPS URL', () => {
        const invite = createInviteV2(payload, 'https://join.example');
        expect(invite.url).toMatch(/^https:\/\/join\.example\/invite\/.+#key=/);
        expect(parseInviteV2(invite.url)).toEqual(payload);
        expect(parseInviteV2(`${invite.token}#key=${invite.decryptionKey}`)).toEqual(payload);
    });

    it('keeps the decryption key and plaintext fields out of the server request path', () => {
        const invite = createInviteV2(payload, 'https://join.example');
        const url = new URL(invite.url);
        expect(url.pathname).not.toContain(invite.decryptionKey);
        expect(url.pathname).not.toContain(payload.groupId);
        expect(url.pathname).not.toContain(payload.relayUrl);
        expect(url.pathname).not.toContain(payload.claimSecret);
        expect(() => parseInviteV2(`https://join.example${url.pathname}`)).toThrow();
    });

    it('rejects tampered ciphertext and incorrect fragment keys', () => {
        const invite = createInviteV2(payload, 'https://join.example');
        const replacement = invite.token[0] === 'A' ? 'B' : 'A';
        const tampered = `${replacement}${invite.token.slice(1)}#key=${invite.decryptionKey}`;
        expect(() => parseInviteV2(tampered)).toThrow('tampered');
        expect(() => parseInviteV2(`${invite.token}#key=${'D'.repeat(43)}`)).toThrow('tampered');
    });

    it('rejects insecure join and relay URLs', () => {
        expect(() => createInviteV2(payload, 'http://join.example')).toThrow('HTTPS');
        expect(() => createInviteV2({ ...payload, relayUrl: 'http://relay.example' }, 'https://join.example'))
            .toThrow();
    });

    it('allows insecure loopback URLs only for local development', () => {
        const invite = createInviteV2(
            { ...payload, relayUrl: 'ws://localhost:8787/ws' },
            'http://localhost:5173',
        );
        expect(invite.url).toMatch(/^http:\/\/localhost:5173\/invite\//);
        expect(parseInviteV2(invite.url).relayUrl).toBe('ws://localhost:8787/ws');
        expect(() => createInviteV2(
            { ...payload, relayUrl: 'ws://relay.example/ws' },
            'https://join.example',
        )).toThrow();
    });
});
