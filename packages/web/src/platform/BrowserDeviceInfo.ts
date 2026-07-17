import type { DeviceInfo } from './DeviceInfo';

export class BrowserDeviceInfo implements DeviceInfo {
    private readonly userAgent: string;

    constructor(userAgent: string = navigator.userAgent) {
        this.userAgent = userAgent;
    }

    deviceName(displayName: string): string {
        const platform = /iPad|iPhone|iPod/.test(this.userAgent)
            ? 'iOS Device'
            : /Mac OS X/.test(this.userAgent)
                ? 'Mac'
                : /Android/.test(this.userAgent)
                    ? 'Android Device'
                    : /Windows/.test(this.userAgent)
                        ? 'Windows PC'
                        : 'Browser';
        return `${displayName}'s ${platform}`;
    }
}
