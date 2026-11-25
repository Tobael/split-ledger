import type { GroupId } from '../types.js';
import type { GroupAccessV2 } from '../protocol-v2/storage.js';
import { deriveGroupKey, encryptForRelay, decryptFromRelay } from './group-cipher.js';
import { RelayTransport } from './relay-transport.js';
import type { Transport, TransportEntry } from './transport.js';

function decodeBase64(value: string): Uint8Array {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function encodeBase64(value: Uint8Array): string {
    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += 32768) {
        chunks.push(String.fromCharCode(...value.subarray(offset, offset + 32768)));
    }
    return btoa(chunks.join(''));
}
export function createRelayForAccess(access: GroupAccessV2): Transport {
    const url = new URL(access.relayUrl);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    return new RelayTransport({ url: url.toString(), groupCapabilities: { [access.groupId]: access.relayGroupCapability } });
}

/** Fetch, validate/merge, republish the durable set, then perform a read barrier. */
export async function exchangeEncryptedSet<T>(options: {
    access: GroupAccessV2;
    transport?: Transport;
    parse: (value: unknown, operationId: string) => T;
    local: () => Promise<readonly T[]>;
    id: (record: T) => string;
    accept: (records: T[]) => Promise<void>;
}): Promise<void> {
    const { access } = options;
    const transport = options.transport ?? createRelayForAccess(access);
    const groupId = access.groupId as GroupId;
    const key = deriveGroupKey(decodeBase64(access.groupSecret), groupId);
    const decode = (entries: TransportEntry[]) => entries.map((entry) => options.parse(
        JSON.parse(new TextDecoder().decode(decryptFromRelay(decodeBase64(entry.encryptedOperation), key))), entry.operationId,
    ));
    try {
        await transport.connect(groupId);
        let failure: unknown;
        try {
            await options.accept(decode(await transport.getOperations(groupId)));
        } catch (error) {
            failure = error;
        }
        // Even a pruned or malformed remote set must not prevent healing from local history.
        const local = await options.local();
        for (const record of local) {
            await transport.publishEntry(groupId, {
                operationId: options.id(record),
                encryptedOperation: encodeBase64(encryptForRelay(new TextEncoder().encode(JSON.stringify(record)), key)),
            });
        }
        const remote = await transport.getOperations(groupId);
        const ids = new Set(remote.map(({ operationId }) => operationId));
        if (local.some((record) => !ids.has(options.id(record)))) throw new Error('Relay did not retain published records');
        await options.accept(decode(remote));
        // The second fetch may have healed a previously incomplete remote set.
        if (failure && remote.length === 0) throw failure;
    } finally {
        await transport.disconnectAll();
    }
}
