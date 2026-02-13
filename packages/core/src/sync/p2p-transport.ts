// =============================================================================
// SplitLedger — P2P Transport (libp2p/WebRTC)
// =============================================================================
//
// Direct peer-to-peer communication via libp2p with WebRTC data channels.
// Uses our relay server for WebRTC signaling (SDP offer/answer exchange).
// Falls back gracefully if direct connections cannot be established.
//

import { createLibp2p, type Libp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import type { GroupId } from '../types.js';
import type {
    Transport,
    TransportEntry,
    OnEntryHandler,
    OnConnectionStateHandler,
} from './transport.js';

// ─── libp2p Protocol ───

const PROTOCOL = '/splitledger/entry/1.0.0';

// ─── P2PTransport ───

export interface P2PTransportOptions {
    /** If true, node startup/shutdown is managed externally */
    externalNode?: Libp2p;
}

export class P2PTransport implements Transport {
    private node: Libp2p | null = null;
    private externalNode: Libp2p | null;
    private entryHandlers: OnEntryHandler[] = [];
    private connectionStateHandlers: OnConnectionStateHandler[] = [];
    private connectedGroups = new Set<GroupId>();
    private _connected = false;

    /** Recently seen entry IDs for dedup */
    private seenEntryIds = new Set<string>();

    /** Accumulated entries from peers, by group */
    private peerEntries = new Map<GroupId, TransportEntry[]>();

    constructor(options: P2PTransportOptions = {}) {
        this.externalNode = options.externalNode ?? null;
    }

    get connected(): boolean {
        return this._connected;
    }

    // ─── Connection Management ───

    async connect(groupId: GroupId): Promise<void> {
        this.connectedGroups.add(groupId);

        if (!this.node) {
            await this.startNode();
        }
    }

    async disconnect(groupId: GroupId): Promise<void> {
        this.connectedGroups.delete(groupId);

        if (this.connectedGroups.size === 0) {
            await this.stopNode();
        }
    }

    async disconnectAll(): Promise<void> {
        this.connectedGroups.clear();
        await this.stopNode();
    }

    // ─── Entry Operations ───

    async publishEntry(groupId: GroupId, entry: TransportEntry): Promise<void> {
        if (!this.node) return;

        const message = JSON.stringify({
            type: 'ENTRY',
            groupId,
            ...entry,
        });

        // Send to all connected peers
        const connections = this.node.getConnections();
        for (const conn of connections) {
            try {
                const stream = await conn.newStream(PROTOCOL);
                const encoder = new TextEncoder();
                const data = encoder.encode(message);
                // Write length-prefixed message using libp2p's sink
                const header = new Uint8Array(4);
                new DataView(header.buffer).setUint32(0, data.length, false);
                const payload = new Uint8Array(header.length + data.length);
                payload.set(header, 0);
                payload.set(data, header.length);

                // Use the sink to write data
                await stream.sink((async function* () {
                    yield payload;
                })());
            } catch {
                // Peer may have disconnected; continue to next
            }
        }
    }

    async getEntriesAfter(groupId: GroupId, _afterLamportClock: number): Promise<TransportEntry[]> {
        // P2P transport doesn't support historical queries the same way relay does.
        // Return any buffered entries from this group.
        const entries = this.peerEntries.get(groupId) ?? [];
        const filtered = entries.filter((e) => e.lamportClock > _afterLamportClock);
        return filtered;
    }

    async getFullLedger(_groupId: GroupId): Promise<TransportEntry[]> {
        // Full ledger fetch is a relay responsibility.
        // P2P transport returns whatever it has buffered.
        return this.peerEntries.get(_groupId) ?? [];
    }

    // ─── Event Handlers ───

    onEntry(handler: OnEntryHandler): void {
        this.entryHandlers.push(handler);
    }

    onConnectionState(handler: OnConnectionStateHandler): void {
        this.connectionStateHandlers.push(handler);
    }

    // ─── Internal ───

    private async startNode(): Promise<void> {
        if (this.externalNode) {
            this.node = this.externalNode;
            this._connected = true;
            this.emitConnectionState('connected');
            return;
        }

        try {
            this.node = await createLibp2p({
                transports: [
                    webRTC(),
                    circuitRelayTransport(),
                ],
                connectionEncrypters: [noise()],
                streamMuxers: [yamux()],
                services: {
                    identify: identify(),
                },
            });

            // Handle incoming streams on our protocol
            this.node.handle(PROTOCOL, async ({ stream }) => {
                try {
                    const chunks: Uint8Array[] = [];
                    for await (const chunk of stream.source) {
                        chunks.push(chunk.subarray());
                    }
                    const data = concatUint8Arrays(chunks);
                    // Skip 4-byte length prefix if present
                    const offset = data.length > 4 ? 4 : 0;
                    const text = new TextDecoder().decode(data.subarray(offset));
                    const msg = JSON.parse(text) as {
                        type: string;
                        groupId: string;
                        encryptedEntry: string;
                        lamportClock: number;
                        senderPubkey: string;
                    };

                    if (msg.type === 'ENTRY') {
                        const groupId = msg.groupId as GroupId;
                        const entry: TransportEntry = {
                            encryptedEntry: msg.encryptedEntry,
                            lamportClock: msg.lamportClock,
                            senderPubkey: msg.senderPubkey,
                        };

                        // Dedup
                        const dedupKey = `${groupId}:${entry.lamportClock}:${entry.senderPubkey}`;
                        if (!this.seenEntryIds.has(dedupKey)) {
                            this.seenEntryIds.add(dedupKey);

                            // Buffer
                            if (!this.peerEntries.has(groupId)) {
                                this.peerEntries.set(groupId, []);
                            }
                            this.peerEntries.get(groupId)!.push(entry);

                            // Notify handlers
                            for (const handler of this.entryHandlers) {
                                handler(groupId, entry);
                            }
                        }
                    }
                } catch {
                    // Malformed message from peer
                }
            });

            await this.node.start();
            this._connected = true;
            this.emitConnectionState('connected');

            // Monitor connections
            this.node.addEventListener('peer:connect', () => {
                this._connected = true;
                this.emitConnectionState('connected');
            });

            this.node.addEventListener('peer:disconnect', () => {
                if (this.node && this.node.getConnections().length === 0) {
                    this.emitConnectionState('disconnected');
                }
            });
        } catch (err) {
            this._connected = false;
            this.emitConnectionState('disconnected');
            throw err;
        }
    }

    private async stopNode(): Promise<void> {
        if (this.externalNode) {
            // Don't stop externally managed nodes
            this.node = null;
            this._connected = false;
            return;
        }

        if (this.node) {
            await this.node.stop();
            this.node = null;
            this._connected = false;
            this.emitConnectionState('disconnected');
        }
    }

    private emitConnectionState(state: 'connected' | 'disconnected' | 'reconnecting'): void {
        for (const handler of this.connectionStateHandlers) {
            handler(state);
        }
    }
}

// ─── Helpers ───

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
