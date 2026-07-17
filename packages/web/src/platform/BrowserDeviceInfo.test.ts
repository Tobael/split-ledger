import { describe, expect, it } from 'vitest';
import { BrowserDeviceInfo } from './BrowserDeviceInfo';

describe('BrowserDeviceInfo', () => {
    it.each([
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', "Alex's iOS Device"],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', "Alex's Mac"],
        ['Mozilla/5.0 (Linux; Android 15; Pixel 9)', "Alex's Android Device"],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', "Alex's Windows PC"],
        ['Mozilla/5.0 (X11; Linux x86_64)', "Alex's Browser"],
    ])('maps a browser user agent to a device name', (userAgent, expected) => {
        expect(new BrowserDeviceInfo(userAgent).deviceName('Alex')).toBe(expected);
    });
});
