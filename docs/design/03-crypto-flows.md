# 3. Cryptographic Flows

## 3.1 Identity Creation

```
FUNCTION createIdentity(displayName: string):
  1. rootKeyPair ← Ed25519.generateKeyPair()
  2. deviceKeyPair ← Ed25519.generateKeyPair()
  3. deviceName ← getDeviceName()       // e.g. "Tobias's iPhone"
  4. authPayload ← canonicalize(deviceKeyPair.publicKey ‖ rootKeyPair.publicKey ‖ nowMs())
  5. authSignature ← Ed25519.sign(authPayload, rootKeyPair.secretKey)
  6. deviceAuthorization ← {
       devicePublicKey: deviceKeyPair.publicKey,
       rootPublicKey: rootKeyPair.publicKey,
       deviceName,
       authorizedAt: nowMs(),
       authorizationSignature: authSignature
     }
  7. STORE rootKeyPair in platform secure storage (Keychain / Keystore / Web Crypto)
  8. STORE deviceKeyPair in platform secure storage
  9. STORE deviceAuthorization
  10. RETURN { rootIdentity, deviceIdentity }
```

> [!IMPORTANT]
> The root secret key MUST be stored in the platform's hardware-backed secure enclave where available (iOS Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, Android Keystore).

## 3.2 Device Authorization (Adding a Second Device)

```
PRECONDITION: User has root key access on existing Device A. New Device B to authorize.

--- Device B (new) ---
  1. deviceKeyPairB ← Ed25519.generateKeyPair()
  2. Display deviceKeyPairB.publicKey as QR code or shareable token

--- Device A (existing, has root key) ---
  3. Scan / receive deviceKeyPairB.publicKey
  4. authPayload ← canonicalize(deviceKeyPairB.publicKey ‖ rootPublicKey ‖ nowMs())
  5. authSignature ← Ed25519.sign(authPayload, rootSecretKey)
  6. FOR EACH group the user belongs to:
       a. Create DeviceAuthorized ledger entry:
            payload = {
              ownerRootPubkey: rootPublicKey,
              devicePublicKey: deviceKeyPairB.publicKey,
              deviceName: "Device B",
              authorizationSignature: authSignature
            }
       b. previousHash ← latestEntry.entryId
       c. lamportClock ← currentLamport + 1
       d. entryContent ← canonicalize(previousHash, lamportClock, timestamp,
                          EntryType.DeviceAuthorized, payload, deviceKeyPairA.publicKey)
       e. entryId ← SHA256(entryContent)
       f. signature ← Ed25519.sign(entryId, deviceKeyPairA.secretKey)
       g. APPEND entry to ledger
       h. BROADCAST entry to peers

--- Device B ---
  7. Receive DeviceAuthorized entries via sync
  8. Store deviceKeyPairB + authorization
  9. Device B is now operational
```

## 3.3 Invite Creation & Verification

### Invite Creation (by existing member)

```
FUNCTION createInvite(groupId, rootKeyPair, ttlMs = 7 * 24 * 60 * 60 * 1000):
  1. expiresAt ← nowMs() + ttlMs
  2. invitePayload ← canonicalize(groupId ‖ rootKeyPair.publicKey ‖ expiresAt)
  3. inviteSignature ← Ed25519.sign(invitePayload, rootKeyPair.secretKey)
  4. token ← { groupId, inviterRootPubkey: rootKeyPair.publicKey, expiresAt, inviteSignature }
  5. serialized ← base64url(canonicalize(token))
  6. RETURN "splitledger://join?invite=" + serialized
```

### Invite Verification & Join (by new member)

```
FUNCTION joinViaInvite(inviteLink, myRootKeyPair, myDeviceKeyPair):
  1. token ← parseInviteLink(inviteLink)

  --- Verify invite ---
  2. IF nowMs() > token.expiresAt → REJECT "Invite expired"
  3. invitePayload ← canonicalize(token.groupId ‖ token.inviterRootPubkey ‖ token.expiresAt)
  4. IF NOT Ed25519.verify(invitePayload, token.inviteSignature, token.inviterRootPubkey)
       → REJECT "Invalid invite signature"

  --- Sync group ledger ---
  5. Connect to relay or peers for token.groupId
  6. Download and validate full ledger
  7. Verify token.inviterRootPubkey is active member of group

  --- Create MemberAdded entry ---
  8. payload ← {
       memberRootPubkey: myRootKeyPair.publicKey,
       memberDisplayName: myDisplayName,
       inviteToken: token
     }
  9. Build, sign, append, and broadcast MemberAdded entry (standard flow)
  10. RETURN success
```

### Invite Verification by Peers (on receiving MemberAdded entry)

```
FUNCTION verifyMemberAddedEntry(entry, groupState):
  1. Extract inviteToken from entry.payload
  2. Verify inviteToken.inviterRootPubkey is active member at this point in ledger
  3. Verify inviteToken is not expired relative to entry.timestamp
     (allow ±5 minute clock skew tolerance)
  4. Reconstruct invitePayload ← canonicalize(groupId ‖ inviterRootPubkey ‖ expiresAt)
  5. Verify Ed25519.verify(invitePayload, inviteToken.inviteSignature, inviterRootPubkey)
  6. Verify entry.payload.memberRootPubkey is NOT already an active member
  7. IF all pass → ACCEPT entry
```

## 3.4 Expense Creation

```
FUNCTION createExpense(group, description, amount, currency, paidBy, splits, deviceKeyPair):
  1. ASSERT sum(splits.values()) == amount   // enforce exact split
  2. ASSERT paidBy is active member
  3. ASSERT all split keys are active members

  4. payload ← {
       description,
       amountMinorUnits: amount,
       currency,
       paidByRootPubkey: paidBy,
       splits
     }
  5. previousHash ← group.latestEntryHash
  6. lamportClock ← group.currentLamportClock + 1
  7. entryContent ← canonicalize(previousHash, lamportClock, nowMs(),
                     EntryType.ExpenseCreated, payload, deviceKeyPair.publicKey)
  8. entryId ← SHA256(entryContent)
  9. signature ← Ed25519.sign(entryId, deviceKeyPair.secretKey)
  10. entry ← { entryId, previousHash, lamportClock, timestamp: nowMs(),
               entryType: EntryType.ExpenseCreated, payload,
               creatorDevicePubkey: deviceKeyPair.publicKey, signature }
  11. LedgerEngine.validate(entry)    // self-check
  12. StorageAdapter.appendEntry(group.groupId, entry)
  13. SyncManager.broadcast(entry)
  14. RETURN entry
```

## 3.5 Root Key Recovery (Social Recovery)

```
FLOW: User "Alice" lost root key. Group has N active members (excluding Alice).
      Majority threshold = floor(N/2) + 1

--- Alice (on new or existing device) ---
  1. newRootKeyPair ← Ed25519.generateKeyPair()
  2. Create recovery request (out-of-band: in-app prompt, chat, etc.):
       recoveryPayload ← canonicalize(
         alice.oldRootPubkey ‖ newRootKeyPair.publicKey ‖ groupId
       )
  3. Share newRootKeyPair.publicKey with group members
     (via relay broadcast or out-of-band)

--- Each co-signing member ---
  4. Verify Alice's identity through out-of-band channel
     (video call, in-person, shared secret, etc.)
  5. recoveryPayload ← canonicalize(
       alice.oldRootPubkey ‖ alice.newRootPubkey ‖ groupId
     )
  6. coSignature ← Ed25519.sign(recoveryPayload, own.rootSecretKey)
  7. Send { signerRootPubkey, coSignature } to Alice or to the group

--- Alice (after collecting ≥ threshold co-signatures) ---
  8. payload ← {
       previousRootPubkey: oldRootPubkey,
       newRootPubkey: newRootKeyPair.publicKey,
       coSignatures: [ { signerRootPubkey, signature }, ... ]
     }
  9. Create RootKeyRotation ledger entry
  10. BROADCAST to group

--- All peers (on receiving RootKeyRotation) ---
  11. Count valid co-signatures from DISTINCT active members
  12. IF count >= floor(activeMembers.size / 2) + 1 → ACCEPT
  13. Update member state: replace alice.rootPubkey
  14. All future entries from Alice must be signed by devices authorized
      under the new root key
```

## Canonical Serialization

All data that is hashed or signed MUST use deterministic serialization:

```typescript
function canonicalize(obj: unknown): Uint8Array {
  // 1. JSON.stringify with sorted keys (no whitespace)
  // 2. Encode as UTF-8
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  return new TextEncoder().encode(json);
}
```

> [!NOTE]
> Sorted-key JSON provides sufficient determinism for this application. For additional rigor, consider [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785) which handles Unicode normalization and number formatting edge cases.
