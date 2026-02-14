/**
 * Identity Export/Import — Password-encrypted identity transfer
 *
 * Uses Web Crypto API:
 *   PBKDF2 (100k iterations, SHA-256) → AES-256-GCM
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const EXPORT_VERSION = 1;

interface EncryptedEnvelope {
    v: number;       // version
    s: string;       // salt (base64)
    iv: string;      // iv (base64)
    ct: string;      // ciphertext (base64)
}

// ─── Helpers ───

function toBase64(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

// ─── Export ───

export async function encryptIdentity(identityJson: string, password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(password, salt);

    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(identityJson),
    );

    const envelope: EncryptedEnvelope = {
        v: EXPORT_VERSION,
        s: toBase64(salt.buffer),
        iv: toBase64(iv.buffer),
        ct: toBase64(ciphertext),
    };

    return JSON.stringify(envelope, null, 2);
}

export function downloadIdentityFile(content: string, filename = 'splitledger-identity.json'): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Import ───

export async function decryptIdentity(fileContent: string, password: string): Promise<string> {
    let envelope: EncryptedEnvelope;
    try {
        envelope = JSON.parse(fileContent) as EncryptedEnvelope;
    } catch {
        throw new Error('INVALID_FILE');
    }

    if (envelope.v !== EXPORT_VERSION || !envelope.s || !envelope.iv || !envelope.ct) {
        throw new Error('INVALID_FILE');
    }

    const salt = new Uint8Array(fromBase64(envelope.s));
    const iv = new Uint8Array(fromBase64(envelope.iv));
    const ciphertext = fromBase64(envelope.ct);
    const key = await deriveKey(password, salt);

    try {
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext,
        );
        return new TextDecoder().decode(plaintext);
    } catch {
        throw new Error('WRONG_PASSWORD');
    }
}

export function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}
