# 5. Sync Protocol Pseudocode

## Overview

The sync protocol is a pull-based, entry-level exchange. Each peer maintains its own copy of the ordered ledger. Synchronization uses Lamport clocks and entry hashes to efficiently detect and fill gaps.

## Peer Handshake

```
MESSAGE SyncRequest {
  groupId:          GroupId
  latestEntryHash:  Hash          // tip of local chain
  lamportClock:     number        // highest Lamport clock seen
  knownEntryCount:  number        // total entries in local ledger
}

MESSAGE SyncResponse {
  status:           'IN_SYNC' | 'HAS_UPDATES' | 'NEED_ENTRIES'
  latestEntryHash:  Hash
  lamportClock:     number
  knownEntryCount:  number
  // If HAS_UPDATES: entries the responder has that the requester likely needs
  missingEntries?:  LedgerEntry[]
  // If NEED_ENTRIES: range of Lamport clocks the responder needs
  requestedRange?:  { fromLamport: number, toLamport: number }
}
```

## Sync Flow

```
FUNCTION syncWithPeer(peer: PeerConnection, groupId: GroupId):
  local ← getLocalState(groupId)

  // ─── Step 1: Exchange state summaries ───
  SEND SyncRequest {
    groupId,
    latestEntryHash: local.latestEntryHash,
    lamportClock: local.currentLamportClock,
    knownEntryCount: local.entryCount
  } TO peer

  response ← AWAIT peer.SyncResponse

  // ─── Step 2: Determine action ───
  IF response.status == 'IN_SYNC':
    RETURN  // nothing to do

  IF response.status == 'HAS_UPDATES':
    // Peer has entries we don't have
    FOR EACH entry IN response.missingEntries (ordered by Lamport clock):
      validation ← validateEntry(entry, localLedger, localGroupState)
      IF validation.valid:
        appendEntry(groupId, entry)
        applyEntry(entry, localGroupState)
      ELSE:
        LOG warning "Rejected entry from peer: " + validation.errors
        // Do NOT disconnect; continue processing remaining entries

  IF response.status == 'NEED_ENTRIES':
    // Peer needs entries from us
    entries ← getEntriesInRange(groupId,
                response.requestedRange.fromLamport,
                response.requestedRange.toLamport)
    SEND SyncResponse {
      status: 'HAS_UPDATES',
      latestEntryHash: local.latestEntryHash,
      lamportClock: local.currentLamportClock,
      knownEntryCount: local.entryCount,
      missingEntries: entries
    } TO peer

  // ─── Step 3: If both sides had updates, repeat ───
  IF local state changed:
    syncWithPeer(peer, groupId)  // one more round to converge
```

## Efficient Gap Detection

```
FUNCTION detectMissingEntries(localClock, localHash, remoteClock, remoteHash):
  IF localHash == remoteHash:
    RETURN 'IN_SYNC'
  IF localClock < remoteClock:
    RETURN { status: 'NEED_ENTRIES', fromLamport: localClock + 1, toLamport: remoteClock }
  IF localClock > remoteClock:
    RETURN { status: 'HAS_UPDATES' }
  // Same clock but different hash → divergence at same logical time
  // Exchange full entry list for this clock value to find diff
  RETURN { status: 'NEED_RECONCILIATION', atLamport: localClock }
```

## Periodic Sync

```
FUNCTION backgroundSync(groupId):
  EVERY 30 seconds:
    peers ← discoverPeers(groupId)   // via libp2p or relay
    FOR EACH peer IN peers:
      TRY:
        syncWithPeer(peer, groupId)
      CATCH error:
        LOG warning "Sync failed with peer: " + error
        // Will retry on next cycle
```

## New Entry Broadcast (Eager Push)

```
FUNCTION broadcastEntry(entry: LedgerEntry, groupId: GroupId):
  // Push to all connected peers immediately
  peers ← getConnectedPeers(groupId)
  FOR EACH peer IN peers:
    SEND entry TO peer via P2PTransport

  // Also push to relay for offline peers
  encrypted ← encryptForGroup(entry, groupId)
  RelayTransport.publish(groupId, encrypted)
```

## Relay-Assisted Sync

```
FUNCTION syncViaRelay(groupId: GroupId):
  // The relay stores encrypted entries as a cache
  localClock ← getLocalLamportClock(groupId)

  SEND {
    action: 'GET_ENTRIES_AFTER',
    groupId,
    afterLamportClock: localClock
  } TO relay via WebSocket

  response ← AWAIT relay.response
  FOR EACH encryptedEntry IN response.entries:
    entry ← decryptForGroup(encryptedEntry, groupId)
    validation ← validateEntry(entry, localLedger, localGroupState)
    IF validation.valid:
      appendEntry(groupId, entry)
```

## Initial Sync (New Member Joining)

```
FUNCTION initialSync(groupId: GroupId):
  // New member needs the full ledger
  // Try P2P first, then relay
  entries ← []

  TRY:
    peer ← findAnyPeer(groupId)
    SEND { action: 'GET_FULL_LEDGER', groupId } TO peer
    entries ← AWAIT peer.response.entries
  CATCH:
    // Fallback to relay
    SEND { action: 'GET_FULL_LEDGER', groupId } TO relay
    encryptedEntries ← AWAIT relay.response.entries
    entries ← encryptedEntries.map(e => decryptForGroup(e, groupId))

  // Validate the ENTIRE chain from genesis
  result ← validateFullChain(entries)
  IF result.valid:
    FOR EACH entry IN result.orderedEntries:
      appendEntry(groupId, entry)
    RETURN result.finalState
  ELSE:
    THROW "Received invalid ledger from peer/relay"
```
