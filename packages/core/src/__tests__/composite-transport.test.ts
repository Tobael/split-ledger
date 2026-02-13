// =============================================================================
// CompositeTransport — Unit Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroupId } from '../types.js';
import type { Transport, TransportEntry, OnEntryHandler, OnConnectionStateHandler } from '../sync/transport.js';
import { CompositeTransport } from '../sync/composite-transport.js';

// ─── Mock Transport ───

function createMockTransport(): Transport & {
    _entryHandlers: OnEntryHandler[];
    _connHandlers: OnConnectionStateHandler[];
    _simulateEntry(groupId: GroupId, entry: TransportEntry): void;
    _simulateConnectionState(state: 'connected' | 'disconnected' | 'reconnecting'): void;
} {
    const _entryHandlers: OnEntryHandler[] = [];
    const _connHandlers: OnConnectionStateHandler[] = [];

    return {
        connected: true,
        _entryHandlers,
        _connHandlers,

        connect: vi.fn(async () => { }),
        disconnect: vi.fn(async () => { }),
        disconnectAll: vi.fn(async () => { }),
        publishEntry: vi.fn(async () => { }),
        getEntriesAfter: vi.fn(async () => []),
        getFullLedger: vi.fn(async () => []),

        onEntry(handler: OnEntryHandler) {
            _entryHandlers.push(handler);
        },
        onConnectionState(handler: OnConnectionStateHandler) {
            _connHandlers.push(handler);
        },

        _simulateEntry(groupId: GroupId, entry: TransportEntry) {
            for (const h of _entryHandlers) h(groupId, entry);
        },
        _simulateConnectionState(state: 'connected' | 'disconnected' | 'reconnecting') {
            for (const h of _connHandlers) h(state);
        },
    };
}

const makeEntry = (clock: number, sender = 'peer-a'): TransportEntry => ({
    encryptedEntry: Buffer.from(`data-${clock}`).toString('base64'),
    lamportClock: clock,
    senderPubkey: sender,
});

describe('CompositeTransport', () => {
    let relay: ReturnType<typeof createMockTransport>;
    let p2p: ReturnType<typeof createMockTransport>;
    let composite: CompositeTransport;
    const groupId = 'group-123' as GroupId;

    beforeEach(() => {
        relay = createMockTransport();
        p2p = createMockTransport();
        composite = new CompositeTransport({ relay, p2p });
    });

    // ─── Connection ───

    it('connects to both relay and P2P', async () => {
        await composite.connect(groupId);
        expect(relay.connect).toHaveBeenCalledWith(groupId);
        expect(p2p.connect).toHaveBeenCalledWith(groupId);
    });

    it('continues if P2P connect fails', async () => {
        (p2p.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('No WebRTC'));
        await expect(composite.connect(groupId)).resolves.toBeUndefined();
        expect(relay.connect).toHaveBeenCalledWith(groupId);
    });

    it('disconnects both transports', async () => {
        await composite.disconnect(groupId);
        expect(relay.disconnect).toHaveBeenCalledWith(groupId);
        expect(p2p.disconnect).toHaveBeenCalledWith(groupId);
    });

    it('disconnectAll on both', async () => {
        await composite.disconnectAll();
        expect(relay.disconnectAll).toHaveBeenCalled();
        expect(p2p.disconnectAll).toHaveBeenCalled();
    });

    it('connected returns true when either transport is connected', () => {
        expect(composite.connected).toBe(true);
    });

    // ─── Publishing ───

    it('publishes to both relay and P2P', async () => {
        const entry = makeEntry(1);
        await composite.publishEntry(groupId, entry);
        expect(relay.publishEntry).toHaveBeenCalledWith(groupId, entry);
        expect(p2p.publishEntry).toHaveBeenCalledWith(groupId, entry);
    });

    it('succeeds if P2P publish fails', async () => {
        (p2p.publishEntry as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('P2P down'));
        const entry = makeEntry(1);
        await expect(composite.publishEntry(groupId, entry)).resolves.toBeUndefined();
        expect(relay.publishEntry).toHaveBeenCalledWith(groupId, entry);
    });

    // ─── Fetching ───

    it('getEntriesAfter delegates to relay', async () => {
        const entries = [makeEntry(5), makeEntry(6)];
        (relay.getEntriesAfter as ReturnType<typeof vi.fn>).mockResolvedValue(entries);

        const result = await composite.getEntriesAfter(groupId, 4);
        expect(result).toEqual(entries);
        expect(relay.getEntriesAfter).toHaveBeenCalledWith(groupId, 4);
        expect(p2p.getEntriesAfter).not.toHaveBeenCalled();
    });

    it('getFullLedger delegates to relay', async () => {
        const entries = [makeEntry(1), makeEntry(2)];
        (relay.getFullLedger as ReturnType<typeof vi.fn>).mockResolvedValue(entries);

        const result = await composite.getFullLedger(groupId);
        expect(result).toEqual(entries);
        expect(relay.getFullLedger).toHaveBeenCalledWith(groupId);
    });

    // ─── Entry Deduplication ───

    it('deduplicates entries from both transports', () => {
        const received: TransportEntry[] = [];
        composite.onEntry((_gid, entry) => received.push(entry));

        const entry = makeEntry(10);

        // Same entry from relay and P2P
        relay._simulateEntry(groupId, entry);
        p2p._simulateEntry(groupId, entry);

        expect(received).toHaveLength(1);
    });

    it('does not deduplicate different entries', () => {
        const received: TransportEntry[] = [];
        composite.onEntry((_gid, entry) => received.push(entry));

        relay._simulateEntry(groupId, makeEntry(10, 'peer-a'));
        p2p._simulateEntry(groupId, makeEntry(11, 'peer-b'));

        expect(received).toHaveLength(2);
    });

    it('does not emit entries that were self-published', async () => {
        const received: TransportEntry[] = [];
        composite.onEntry((_gid, entry) => received.push(entry));

        const entry = makeEntry(20);
        await composite.publishEntry(groupId, entry);

        // Entry echoed back from relay
        relay._simulateEntry(groupId, entry);

        expect(received).toHaveLength(0);
    });

    // ─── Connection State ───

    it('forwards relay connection state', () => {
        const states: string[] = [];
        composite.onConnectionState((state) => states.push(state));

        relay._simulateConnectionState('disconnected');
        relay._simulateConnectionState('reconnecting');
        relay._simulateConnectionState('connected');

        expect(states).toEqual(['disconnected', 'reconnecting', 'connected']);
    });
});
