import { describe, expect, it } from 'vitest';
import { inviteTokenFromUrl } from './LinkReceiver';

describe('inviteTokenFromUrl', () => {
    it.each([
        ['https://join.example/join?token=abc-123', 'abc-123'],
        ['https://join.example/invite/abc-123', 'abc-123'],
        ['https://join.example/join/abc%20123', 'abc 123'],
        ['https://join.example/invite/ciphertext#key=secret_key', 'ciphertext#key=secret_key'],
    ])('extracts supported invite URL %s', (url, token) => {
        expect(inviteTokenFromUrl(url)).toBe(token);
    });

    it.each([
        'not a URL',
        'https://join.example/join',
        'https://join.example/dashboard?token=abc',
        'https://join.example/invite/a/b',
    ])('rejects unsupported URL %s', (url) => {
        expect(inviteTokenFromUrl(url)).toBeNull();
    });
});
