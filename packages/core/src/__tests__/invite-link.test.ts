// =============================================================================
// Invite Link — Unit Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { serializeInviteLink, parseInviteLink } from '../invite-link.js';
import type { GroupId, PublicKey, Signature } from '../types.js';

const mockToken = {
    groupId: 'group-abc-123' as GroupId,
    inviterRootPubkey: 'aabbccdd' as PublicKey,
    expiresAt: 1700000000000,
    inviteSignature: 'sigabc123' as Signature,
};

describe('Invite Link', () => {
    it('serialize → parse roundtrip (token only)', () => {
        const link = serializeInviteLink({ token: mockToken });
        const parsed = parseInviteLink(link);

        expect(parsed.token.groupId).toBe(mockToken.groupId);
        expect(parsed.token.inviterRootPubkey).toBe(mockToken.inviterRootPubkey);
        expect(parsed.token.expiresAt).toBe(mockToken.expiresAt);
        expect(parsed.token.inviteSignature).toBe(mockToken.inviteSignature);
        expect(parsed.relayUrl).toBeUndefined();
        expect(parsed.groupSecret).toBeUndefined();
    });

    it('serialize → parse roundtrip (with relay URL)', () => {
        const link = serializeInviteLink({
            token: mockToken,
            relayUrl: 'wss://relay.example.com',
        });
        const parsed = parseInviteLink(link);

        expect(parsed.token.groupId).toBe(mockToken.groupId);
        expect(parsed.relayUrl).toBe('wss://relay.example.com');
        expect(parsed.groupSecret).toBeUndefined();
    });

    it('serialize → parse roundtrip (with group secret)', () => {
        const link = serializeInviteLink({
            token: mockToken,
            groupSecret: 'deadbeef01234567',
        });
        const parsed = parseInviteLink(link);

        expect(parsed.groupSecret).toBe('deadbeef01234567');
    });

    it('serialize → parse roundtrip (all fields)', () => {
        const link = serializeInviteLink({
            token: mockToken,
            relayUrl: 'wss://relay.example.com',
            groupSecret: 'cafebabe',
        });
        const parsed = parseInviteLink(link);

        expect(parsed.token.groupId).toBe(mockToken.groupId);
        expect(parsed.relayUrl).toBe('wss://relay.example.com');
        expect(parsed.groupSecret).toBe('cafebabe');
    });

    it('produces URL-safe base64 (no +, /, =)', () => {
        const link = serializeInviteLink({ token: mockToken });
        expect(link).not.toMatch(/[+/=]/);
    });

    it('throws on invalid base64', () => {
        expect(() => parseInviteLink('not-valid-!!!'))
            .toThrow('Invalid invite link');
    });

    it('throws on valid base64 but invalid JSON', () => {
        // base64url of "not json"
        const fakeLink = Buffer.from('not json').toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        expect(() => parseInviteLink(fakeLink))
            .toThrow('Invalid invite link');
    });

    it('throws on missing token fields', () => {
        const fakeLink = Buffer.from(JSON.stringify({ t: { g: 'x' } })).toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        expect(() => parseInviteLink(fakeLink))
            .toThrow('missing token fields');
    });
});
