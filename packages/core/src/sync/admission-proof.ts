import { sha256 } from '@noble/hashes/sha2';

const encoder = new TextEncoder();
const DOMAIN = 'fair-money-relay-admission-v1';

function leadingZeroBits(bytes: Uint8Array): number {
    let bits = 0;
    for (const byte of bytes) {
        if (byte === 0) { bits += 8; continue; }
        bits += Math.clz32(byte) - 24;
        break;
    }
    return bits;
}

export function verifyRelayAdmissionProof(groupId: string, capability: string, nonce: string, difficulty: number): boolean {
    if (!/^[0-9a-f]{1,16}$/.test(nonce) || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 32) return false;
    const digest = sha256(encoder.encode(`${DOMAIN}:${groupId}:${capability}:${nonce}`));
    return leadingZeroBits(digest) >= difficulty;
}

export async function solveRelayAdmissionProof(groupId: string, capability: string, difficulty: number): Promise<string> {
    if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 32) throw new Error('Invalid relay admission difficulty');
    for (let nonce = 0; nonce < Number.MAX_SAFE_INTEGER; nonce += 1) {
        const candidate = nonce.toString(16);
        if (verifyRelayAdmissionProof(groupId, capability, candidate, difficulty)) return candidate;
        if (nonce > 0 && nonce % 2048 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Unable to solve relay admission proof');
}
