import { generateRandomBytes } from '../crypto.js';
import type { InvitePayloadV2 } from './invite.js';
import { groupAccessV2Schema, type GroupAccessV2 } from './storage.js';

function base64UrlEncode(bytes: Uint8Array): string {
    let base64: string;
    if (typeof Buffer !== 'undefined') base64 = Buffer.from(bytes).toString('base64');
    else base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createGroupAccessV2(groupId: string, relayUrl: string): GroupAccessV2 {
    return groupAccessV2Schema.parse({
        groupId,
        relayUrl,
        relayGroupCapability: base64UrlEncode(generateRandomBytes(32)),
        groupSecret: base64UrlEncode(generateRandomBytes(32)),
    });
}

export function groupAccessFromInviteV2(invite: InvitePayloadV2): GroupAccessV2 {
    return groupAccessV2Schema.parse({
        groupId: invite.groupId,
        relayUrl: invite.relayUrl,
        relayGroupCapability: invite.relayGroupCapability,
        groupSecret: invite.groupSecret,
    });
}
