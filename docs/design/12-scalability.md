# 12. Scalability Considerations

## Scaling Dimensions

| Dimension | Expected Range | Stress Target |
|-----------|---------------|---------------|
| Members per group | 2–30 | 100 |
| Entries per group | 10–5,000 | 100,000 |
| Groups per user | 1–10 | 50 |
| Devices per user | 1–3 | 10 |
| Entry size | 200 B–2 KB | 64 KB (with receipt hash) |
| Total ledger size per group | 10 KB–1 MB | 200 MB |

## Client-Side Performance

### Balance Computation

**Problem**: Replaying 100K entries to compute balances on every app open is expensive.

**Solution**: Incremental state checkpoints.

```typescript
interface GroupCheckpoint {
  /** Lamport clock at which this checkpoint is valid */
  atLamportClock: number;
  /** entry_id at checkpoint */
  atEntryId: Hash;
  /** Pre-computed group state including balances */
  state: GroupState;
}
```

**Strategy**:
1. On first full sync: replay all entries, save checkpoint
2. On subsequent syncs: load checkpoint, replay only entries after `atLamportClock`
3. Save new checkpoint every 500 entries or on app backgrounding
4. Checkpoint is local-only (not shared with peers)

**Benchmark target**: Replay 1,000 entries in <100ms on mid-range phone (2023 hardware).

### Storage Footprint

| Entries | Estimated Raw Size | With SQLite Overhead | With indexes |
|---------|-------------------|---------------------|-------------|
| 1,000 | ~500 KB | ~750 KB | ~1 MB |
| 10,000 | ~5 MB | ~7.5 MB | ~10 MB |
| 100,000 | ~50 MB | ~75 MB | ~100 MB |

**Mitigation for very large groups**:
- Offer optional "archive" mode: export old entries, keep only last N months locally
- Archived entries can be re-fetched from relay or peers when needed
- Archived entries still count for balance computation (checkpoint carries forward)

### Cryptographic Operations

| Operation | Time (mid-range phone) | Per-entry impact |
|-----------|----------------------|------------------|
| SHA-256 hash (1 KB) | <0.1 ms | ✓ Negligible |
| Ed25519 sign | ~1 ms | One per entry created |
| Ed25519 verify | ~2 ms | One per entry received |
| Full chain verify (1K entries) | ~2 seconds | One-time on join |
| Full chain verify (10K entries) | ~20 seconds | Show progress bar |

## Relay Server Scaling

### Horizontal Architecture

```
                   ┌──────────────┐
                   │  Load        │
       WSS ──────►│  Balancer    │
                   │  (nginx)     │
                   └──────┬───────┘
                    ┌─────┼─────┐
                    ▼     ▼     ▼
               ┌──────┐ ┌──────┐ ┌──────┐
               │Relay │ │Relay │ │Relay │
               │  #1  │ │  #2  │ │  #3  │
               └──┬───┘ └──┬───┘ └──┬───┘
                  │        │        │
            ┌─────▼────────▼────────▼─────┐
            │         Redis Cluster       │
            │   (pub/sub cross-instance)  │
            └─────────────┬───────────────┘
                          │
            ┌─────────────▼───────────────┐
            │     PostgreSQL (primary)     │
            │     + read replicas          │
            └─────────────────────────────┘
```

### Partitioning Strategy

- **Group-based sharding**: Each group is handled by a single relay instance at a time (sticky sessions via group_id hash)
- **Redis pub/sub**: Cross-instance message forwarding for groups with members on different instances
- **PostgreSQL partitioning**: Partition `encrypted_entries` table by `group_id` hash

### Capacity Estimation

| Metric | Per Instance | With 3 Instances |
|--------|-------------|-----------------|
| Concurrent WebSocket connections | 10,000 | 30,000 |
| Messages per second | 5,000 | 15,000 |
| Storage (PostgreSQL) | Shared | Shared |
| Memory (entry cache) | 2 GB | 6 GB |

### Cost Estimation (Cloud)

| Component | Specification | Monthly Cost (est.) |
|-----------|--------------|-------------------|
| 3× Relay instances | 2 vCPU, 4 GB RAM | ~$90 |
| PostgreSQL (managed) | 2 vCPU, 8 GB RAM, 100 GB SSD | ~$80 |
| Redis (managed) | 2 GB | ~$30 |
| Bandwidth (1 TB) | | ~$50 |
| **Total** | | **~$250/month** |

Supports approximately **10,000 active groups** with **50,000 users**.

## P2P Scaling

### WebRTC Connection Limits

- **Browser**: ~50 simultaneous peer connections (practical limit)
- **Mitigation**: For groups > 20 members, use relay-assisted gossip rather than full mesh
- **Gossip protocol**: Each peer connects to ≤6 random peers; entries propagate via flooding with deduplication

### Peer Discovery

- **Small groups (≤10)**: Full mesh via relay signaling
- **Medium groups (11–30)**: Partial mesh; relay as hub
- **Large groups (30+)**: Relay-primary with opportunistic P2P

## Ledger Growth Management

### Entry Compaction (Future)

For groups with very long histories, a future protocol extension could support **compaction entries**:

```typescript
interface CompactionPayload {
  // Signed agreement from all active members that entries
  // before this point can be summarized
  compactedUntilEntryId: Hash;
  compactedUntilLamport: number;
  // Resulting state after replaying all compacted entries
  resultingState: GroupState;
  memberAgreements: Array<{
    memberRootPubkey: PublicKey;
    signature: Signature;
  }>;
}
```

> [!WARNING]
> Compaction is a **breaking protocol change** that requires unanimous member agreement. It should NOT be included in the MVP — the simpler checkpoint-based approach (client-side only, no protocol change) is sufficient for all realistic group sizes.
