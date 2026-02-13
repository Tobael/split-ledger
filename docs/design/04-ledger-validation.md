# 4. Ledger Validation Pseudocode

## Entry-Level Validation

Every entry received from a peer or the relay MUST pass all of the following checks before being appended to the local ledger.

```
FUNCTION validateEntry(entry: LedgerEntry, ledger: LedgerEntry[], groupState: GroupState):
  errors ← []

  // ─── 1. Structural validation ───
  IF entry.entryId is empty           → errors.push("Missing entry_id")
  IF entry.lamportClock < 0           → errors.push("Invalid lamport clock")
  IF entry.timestamp <= 0             → errors.push("Invalid timestamp")
  IF entry.creatorDevicePubkey empty  → errors.push("Missing device pubkey")
  IF entry.signature is empty         → errors.push("Missing signature")

  // ─── 2. Hash integrity ───
  expectedContent ← canonicalize({
    previousHash:        entry.previousHash,
    lamportClock:        entry.lamportClock,
    timestamp:           entry.timestamp,
    entryType:           entry.entryType,
    payload:             entry.payload,
    creatorDevicePubkey: entry.creatorDevicePubkey
  })
  expectedHash ← SHA256(expectedContent)
  IF expectedHash ≠ entry.entryId → errors.push("Hash mismatch: tampered content")

  // ─── 3. Signature verification ───
  IF NOT Ed25519.verify(entry.entryId, entry.signature, entry.creatorDevicePubkey)
    → errors.push("Invalid signature")

  // ─── 4. Previous hash continuity ───
  IF entry.entryType == Genesis:
    IF entry.previousHash ≠ null → errors.push("Genesis must have null previousHash")
    IF ledger.length > 0         → errors.push("Genesis must be first entry")
  ELSE:
    IF entry.previousHash is null → errors.push("Non-genesis must reference previous")
    latestKnown ← ledger[ledger.length - 1]
    // For sync: previousHash may reference an entry we already have (not necessarily the tip)
    IF NOT ledger.any(e => e.entryId == entry.previousHash)
      → errors.push("previousHash references unknown entry")

  // ─── 5. Lamport clock monotonicity ───
  IF ledger.length > 0:
    IF entry.lamportClock <= ledger.last().lamportClock
       AND entry is being appended at tip
      → errors.push("Lamport clock must strictly increase for local appends")

  // ─── 6. Creator authorization ───
  CALL validateCreatorAuthorization(entry, groupState, errors)

  // ─── 7. Type-specific validation ───
  CALL validatePayload(entry, groupState, errors)

  RETURN { valid: errors.length == 0, errors }
```

## Creator Authorization Validation

```
FUNCTION validateCreatorAuthorization(entry, groupState, errors):
  devicePubkey ← entry.creatorDevicePubkey

  IF entry.entryType == Genesis:
    // Genesis is self-authorizing: creator IS the group founder
    RETURN

  // Find which member owns this device
  ownerFound ← false
  FOR EACH member IN groupState.members.values():
    IF member.authorizedDevices.has(devicePubkey):
      IF NOT member.isActive:
        errors.push("Device belongs to removed member: " + member.rootPubkey)
        RETURN
      ownerFound ← true
      BREAK

  IF NOT ownerFound:
    errors.push("Device key not authorized by any active member")

  // Special case: DeviceAuthorized / DeviceRevoked must be from the owner themselves
  //               or the root key holder
  IF entry.entryType == DeviceAuthorized OR entry.entryType == DeviceRevoked:
    ownerRootPubkey ← entry.payload.ownerRootPubkey
    IF NOT deviceBelongsToMember(devicePubkey, ownerRootPubkey, groupState):
      errors.push("Device operations must come from the device owner")
```

## Payload-Specific Validation

```
FUNCTION validatePayload(entry, groupState, errors):
  SWITCH entry.entryType:

    CASE Genesis:
      IF NOT entry.payload.groupId         → errors.push("Missing groupId")
      IF NOT entry.payload.groupName       → errors.push("Missing groupName")
      IF NOT entry.payload.creatorRootPubkey → errors.push("Missing creator key")

    CASE ExpenseCreated:
      p ← entry.payload
      IF p.amountMinorUnits <= 0           → errors.push("Amount must be positive")
      IF NOT isActiveMember(p.paidByRootPubkey, groupState)
        → errors.push("Payer is not active member")
      total ← 0
      FOR EACH (pubkey, share) IN p.splits:
        IF share < 0                       → errors.push("Negative split")
        IF NOT isActiveMember(pubkey, groupState)
          → errors.push("Split includes non-member: " + pubkey)
        total += share
      IF total ≠ p.amountMinorUnits        → errors.push("Splits don't sum to amount")

    CASE ExpenseCorrection:
      p ← entry.payload
      original ← findEntry(p.referencedEntryId, ledger)
      IF original is null                  → errors.push("Referenced entry not found")
      IF original.entryType ≠ ExpenseCreated AND original.entryType ≠ ExpenseCorrection
        → errors.push("Can only correct expense entries")
      // Validate corrected expense payload with same rules as ExpenseCreated
      validateExpensePayload(p.correctedExpense, groupState, errors)

    CASE MemberAdded:
      p ← entry.payload
      IF isActiveMember(p.memberRootPubkey, groupState)
        → errors.push("Member already active")
      // Validate invite token
      CALL verifyMemberAddedEntry(entry, groupState)  // detailed in crypto flows

    CASE MemberRemoved:
      p ← entry.payload
      IF NOT isActiveMember(p.memberRootPubkey, groupState)
        → errors.push("Member not found or already removed")
      // Only the member themselves or group creator can remove
      creatorDevice ← entry.creatorDevicePubkey
      IF NOT (deviceBelongsToMember(creatorDevice, p.memberRootPubkey, groupState)
              OR deviceBelongsToMember(creatorDevice, groupState.creatorRootPubkey, groupState))
        → errors.push("Unauthorized removal")

    CASE DeviceAuthorized:
      p ← entry.payload
      IF NOT isActiveMember(p.ownerRootPubkey, groupState)
        → errors.push("Owner is not active member")
      authPayload ← canonicalize(p.devicePublicKey ‖ p.ownerRootPubkey ‖ entry.timestamp)
      IF NOT Ed25519.verify(authPayload, p.authorizationSignature, p.ownerRootPubkey)
        → errors.push("Device authorization signature invalid")

    CASE DeviceRevoked:
      p ← entry.payload
      IF NOT groupState.members.get(p.ownerRootPubkey)?.authorizedDevices.has(p.devicePublicKey)
        → errors.push("Device not currently authorized")

    CASE RootKeyRotation:
      p ← entry.payload
      IF NOT isActiveMember(p.previousRootPubkey, groupState)
        → errors.push("Previous root key not active member")
      activeCount ← countActiveMembers(groupState) - 1  // exclude the rotating member
      threshold ← floor(activeCount / 2) + 1
      validSigs ← 0
      seenSigners ← new Set()
      FOR EACH cs IN p.coSignatures:
        IF seenSigners.has(cs.signerRootPubkey) → CONTINUE  // no double-counting
        IF NOT isActiveMember(cs.signerRootPubkey, groupState) → CONTINUE
        IF cs.signerRootPubkey == p.previousRootPubkey → CONTINUE  // can't co-sign own recovery
        recoveryPayload ← canonicalize(p.previousRootPubkey ‖ p.newRootPubkey ‖ groupId)
        IF Ed25519.verify(recoveryPayload, cs.signature, cs.signerRootPubkey):
          validSigs += 1
          seenSigners.add(cs.signerRootPubkey)
      IF validSigs < threshold
        → errors.push("Insufficient co-signatures: " + validSigs + "/" + threshold)
```

## Deterministic Total Ordering

```
FUNCTION orderEntries(entries: LedgerEntry[]): LedgerEntry[]
  RETURN entries.sort((a, b) =>
    // Primary: Lamport clock
    IF a.lamportClock ≠ b.lamportClock → a.lamportClock - b.lamportClock
    // Tiebreaker 1: timestamp
    ELSE IF a.timestamp ≠ b.timestamp → a.timestamp - b.timestamp
    // Tiebreaker 2: device pubkey (lexicographic)
    ELSE IF a.creatorDevicePubkey ≠ b.creatorDevicePubkey
      → a.creatorDevicePubkey.localeCompare(b.creatorDevicePubkey)
    // Tiebreaker 3: entry_id (lexicographic)
    ELSE → a.entryId.localeCompare(b.entryId)
  )
```

## Full Chain Validation

```
FUNCTION validateFullChain(entries: LedgerEntry[]): ValidationResult
  ordered ← orderEntries(entries)
  groupState ← empty GroupState
  errors ← []

  FOR i, entry IN ordered:
    result ← validateEntry(entry, ordered[0..i-1], groupState)
    IF NOT result.valid:
      errors.push({ entryIndex: i, entryId: entry.entryId, errors: result.errors })
    ELSE:
      applyEntry(entry, groupState)  // update members, devices, balances

  RETURN { valid: errors.length == 0, errors, finalState: groupState }
```
