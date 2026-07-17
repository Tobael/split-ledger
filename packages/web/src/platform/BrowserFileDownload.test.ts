import { describe, expect, it, vi } from 'vitest';
import { BrowserFileDownload } from './BrowserFileDownload';

describe('BrowserFileDownload', () => {
    it('downloads content and releases its object URL', () => {
        const anchor = { href: '', download: '', click: vi.fn() };
        const createObjectUrl = vi.fn<(blob: Blob) => string>(() => 'blob:identity');
        const revokeObjectUrl = vi.fn();
        new BrowserFileDownload(() => anchor, createObjectUrl, revokeObjectUrl)
            .download('identity.json', 'encrypted', 'application/json');

        expect(anchor).toMatchObject({ href: 'blob:identity', download: 'identity.json' });
        expect(anchor.click).toHaveBeenCalledOnce();
        expect(createObjectUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:identity');
    });
});
