import { describe, expect, it, vi } from 'vitest';
import { BrowserTextSharing } from './BrowserTextSharing';

describe('BrowserTextSharing', () => {
    it('copies text through the platform clipboard', async () => {
        const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
        await new BrowserTextSharing(writeText).copy('invite-link');
        expect(writeText).toHaveBeenCalledWith('invite-link');
    });
});
