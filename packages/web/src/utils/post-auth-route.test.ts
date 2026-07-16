import { describe, expect, it } from 'vitest';
import { postAuthRoute } from './post-auth-route';

describe('postAuthRoute', () => {
    it('returns ordinary logins to the group dashboard', () => {
        expect(postAuthRoute('/settings', '')).toBe('/dashboard');
        expect(postAuthRoute('/', '')).toBe('/dashboard');
    });

    it('preserves invitation destinations', () => {
        expect(postAuthRoute('/invite/token', '?source=message')).toBe('/invite/token?source=message');
        expect(postAuthRoute('/join', '?invite=value')).toBe('/join?invite=value');
    });
});
