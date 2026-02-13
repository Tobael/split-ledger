# 11. Multi-Device Synchronization Design

## Overview

A single participant (one root key) may have multiple authorized devices (each with its own device key). Multi-device sync ensures:

1. All devices see the same ledger state
2. Entries created on any device propagate to the participant's other devices
3. Device authorization/revocation is reflected in real-time

## Device Authorization Graph

```
          Root Key (Alice)
          ┌───────────────┐
          │  ed25519:a1b2  │
          └───────┬───────┘
                  │  signs DeviceAuthorization
        ┌─────────┼─────────┐
        ▼         ▼         ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ iPhone  │ │  iPad   │ │   Web   │
   │ dev:x1  │ │ dev:x2  │ │ dev:x3  │
   └─────────┘ └─────────┘ └─────────┘
```

All three devices can create entries for any group Alice belongs to. Entries are signed by the device key, and peers verify the device key is authorized by Alice's root key.

## Sync Strategy: Same-User Multi-Device

### Scenario: Alice adds expense on iPhone, needs it on iPad

```
1. iPhone creates ExpenseCreated entry
   → signed by dev:x1
   → appended to local ledger
   → broadcast to group via P2P + relay

2. iPad receives entry (via P2P or relay)
   → validates: is dev:x1 authorized by ed25519:a1b2? YES
   → appends to local ledger
   → UI updates immediately

3. Web browser opens later
   → performs sync handshake with relay
   → receives all missed entries
   → full chain validation
   → catches up to latest state
```

### Device-Specific Storage

Each device stores independently:

| Data | Shared | Device-Specific |
|------|--------|-----------------|
| Ledger entries | ✓ (identical on all devices) | |
| Derived group state | ✓ (computed identically) | |
| Root key | ✓ (but stored in device's own secure storage) | |
| Device keypair | | ✓ (never leaves device) |
| Sync cursor | | ✓ (last synced Lamport clock) |
| UI preferences | | ✓ (theme, notifications) |

## Cross-Group Device Authorization

When a device is authorized, a `DeviceAuthorized` entry must be published to **every group** the user belongs to. This ensures all group members recognize the new device.

```
FUNCTION authorizeDeviceAcrossGroups(newDevicePubkey, rootKeyPair, groups):
  authorization ← signDeviceAuthorization(newDevicePubkey, rootKeyPair)

  FOR EACH group IN groups:
    entry ← createLedgerEntry(
      groupId:   group.groupId,
      entryType: DeviceAuthorized,
      payload:   { ownerRootPubkey, devicePublicKey, deviceName, authorizationSignature }
    )
    appendAndBroadcast(entry, group)
```

Similarly, `DeviceRevoked` entries propagate to all groups.

## Root Key Distribution to New Devices

> [!CAUTION]
> The root secret key MUST be transferred securely when adding a new device. This is the most sensitive operation in the system.

### Transfer Mechanism

```
Existing Device (A)                           New Device (B)
─────────────────                             ─────────────
1. Generate ephemeral X25519 keypair A_eph    1. Generate ephemeral X25519 keypair B_eph
2. Display QR: { A_eph.pub, one_time_code }   2. Scan QR code
                                              3. Compute shared_secret = X25519(B_eph.priv, A_eph.pub)
                                              4. Send B_eph.pub to A via relay (identified by one_time_code)
3. Receive B_eph.pub
4. Compute shared_secret = X25519(A_eph.priv, B_eph.pub)
5. encrypted_root_key = AES-GCM(shared_secret, root_secret_key)
6. Send encrypted_root_key to B
                                              7. root_secret_key = AES-GCM-decrypt(shared_secret, encrypted)
                                              8. Verify: root_public_key matches
                                              9. Store in secure storage
```

### Alternative: No Root Key Transfer

For a more conservative approach, the root key can remain on a single "primary" device:

- Additional devices have **only** their device keys
- Only the primary device can authorize/revoke other devices
- If primary device is lost → social recovery is required

This tradeoff is presented to the user in Settings:

```
┌───────────────────────────────────────────┐
│  Security Level                           │
│                                           │
│  ○ Standard (recommended)                 │
│    Your account key is shared across      │
│    your devices. Any device can           │
│    manage other devices.                  │
│                                           │
│  ○ High Security                          │
│    Your account key stays on this         │
│    device only. If lost, use group        │
│    recovery.                              │
└───────────────────────────────────────────┘
```

## Conflict Handling

Since internet connectivity is required, true forks should not occur. However, near-simultaneous entries from different devices of the same user are handled naturally:

1. Each device increments its own view of the Lamport clock
2. If two devices create entries with the same clock value, the deterministic ordering (clock → timestamp → device pubkey → entry ID) ensures all peers converge to the same order
3. No special merge logic is needed — this is not a CRDT; it's ordered append-only

## Presence & Device Status

```
FUNCTION reportDevicePresence(groupId, devicePubkey):
  EVERY 60 seconds:
    broadcast lightweight heartbeat message (NOT a ledger entry):
      { type: 'HEARTBEAT', groupId, devicePubkey, timestamp }

    // Peers update their local "last seen" tracking
    // This is ephemeral metadata, not on the ledger
```

Presence data is used for:
- Showing "online" indicators in member list
- Choosing which peer to sync with first (prefer online devices)
- Estimating recovery ceremony responsiveness
