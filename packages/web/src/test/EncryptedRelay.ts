import type { GroupAccessV2, GroupId, Transport, TransportEntry } from '@splitledger/core';

/** Test transport stores exactly the opaque envelopes used by the production relay. */
export class EncryptedRelay {
    readonly namespaces = new Map<string, Map<string, TransportEntry>>();
    readonly capabilities = new Map<string, string>();
    readonly unavailable = new Set<string>();
    readonly discardWrites = new Set<string>();
    transport = (access: GroupAccessV2): Transport => {
        let connected = false;
        const assertAccess = () => {
            if (!connected || this.unavailable.has(access.groupId)) throw new Error('Relay unavailable');
            const previous = this.capabilities.get(access.groupId);
            if (previous && previous !== access.relayGroupCapability) throw new Error('Invalid capability');
            this.capabilities.set(access.groupId, access.relayGroupCapability);
        };
        const publish = async (_groupId: GroupId, record: TransportEntry) => {
            assertAccess();
            if (this.discardWrites.has(access.groupId)) return;
            const namespace = this.namespaces.get(access.groupId) ?? new Map<string, TransportEntry>();
            if (!namespace.has(record.operationId)) namespace.set(record.operationId, structuredClone(record));
            this.namespaces.set(access.groupId, namespace);
        };
        return {
            async connect() { connected = true; assertAccess(); },
            async disconnect() { connected = false; },
            async disconnectAll() { connected = false; },
            publishEntry: publish, publishDisposableEntry: publish,
            getOperations: async () => { assertAccess(); return structuredClone([...this.namespaces.get(access.groupId)?.values() ?? []]); },
            consumeEntries: async () => { throw new Error('Not a disposable namespace'); },
            onEntry() {}, onConnectionState() {},
            get connected() { return connected; },
            getConnectedGroups: () => connected ? [access.groupId as GroupId] : [],
        };
    };
}
