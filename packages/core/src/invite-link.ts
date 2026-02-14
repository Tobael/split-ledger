// =============================================================================
// SplitLedger — Invite Link Serialization
// =============================================================================
//
// Serializes/parses invite tokens into URL-safe base64 strings.
// The link embeds: invite token + optional relay URL + optional group secret.
//

import type { InviteToken, GroupId, PublicKey, Signature } from './types.js';

/** Data embedded in an invite link */
export interface InviteLinkData {
    token: InviteToken;
    relayUrl?: string;
    groupSecret?: string; // hex-encoded group encryption secret
}

/**
 * Serialize an invite link into a URL-safe base64 string.
 * Format: JSON → UTF-8 → base64url
 */
export function serializeInviteLink(data: InviteLinkData): string {
    const json = JSON.stringify({
        t: {
            g: data.token.groupId,
            i: data.token.inviterRootPubkey,
            e: data.token.expiresAt,
            s: data.token.inviteSignature,
        },
        r: data.relayUrl ?? undefined,
        k: data.groupSecret ?? undefined,
    });

    return base64UrlEncode(new TextEncoder().encode(json));
}

/**
 * Parse an invite link from a URL-safe base64 string.
 * Returns the embedded invite token and optional metadata.
 */
export function parseInviteLink(link: string): InviteLinkData {
    // Extract token if input is a full URL
    let tokenStr = link;
    if (link.includes('?token=')) {
        try {
            const url = new URL(link);
            const t = url.searchParams.get('token');
            if (t) tokenStr = t;
        } catch {
            // Check if it's a partial URL or just has the param
            const parts = link.split('?token=');
            if (parts.length > 1) tokenStr = parts[1]!;
        }
    }

    let json: string;
    try {
        const bytes = base64UrlDecode(tokenStr);
        json = new TextDecoder().decode(bytes);
    } catch {
        throw new Error('Invalid invite link: cannot decode');
    }

    let parsed: {
        t?: { g?: string; i?: string; e?: number; s?: string };
        r?: string;
        k?: string;
    };
    try {
        parsed = JSON.parse(json) as typeof parsed;
    } catch {
        throw new Error('Invalid invite link: malformed JSON');
    }

    if (!parsed.t || !parsed.t.g || !parsed.t.i || !parsed.t.e || !parsed.t.s) {
        throw new Error('Invalid invite link: missing token fields');
    }

    const token: InviteToken = {
        groupId: parsed.t.g as GroupId,
        inviterRootPubkey: parsed.t.i as PublicKey,
        expiresAt: parsed.t.e,
        inviteSignature: parsed.t.s as Signature,
    };

    return {
        token,
        relayUrl: parsed.r,
        groupSecret: parsed.k,
    };
}

// ─── Base64URL helpers ───

function base64UrlEncode(data: Uint8Array): string {
    // Use Buffer in Node, btoa fallback for browser
    let base64: string;
    if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(data).toString('base64');
    } else {
        base64 = btoa(String.fromCharCode(...data));
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
    // Restore standard base64
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding
    while (base64.length % 4 !== 0) {
        base64 += '=';
    }

    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(base64, 'base64'));
    } else {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
}
