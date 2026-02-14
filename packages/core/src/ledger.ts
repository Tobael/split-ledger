// =============================================================================
// SplitLedger — Ledger Engine
// =============================================================================
//
// Core engine for the append-only hash-linked signed ledger.
// Handles: validation, ordering, state application, and entry building.
//

import {
    computeEntryId,
    signEntryId,
    verifyEntrySignature,
} from './crypto.js';
import {
    verifyDeviceAuthorization,
    verifyInviteSignature,
    verifyRecoveryCoSignature,
} from './identity.js';
import { computeBalances } from './balance.js';
import type {
    ChainValidationResult,
    DeviceAuthorizedPayload,
    DeviceRevokedPayload,
    ExpenseCorrectionPayload,
    ExpenseCreatedPayload,
    ExpenseVoidedPayload,
    GenesisPayload,
    GroupMember,
    GroupState,
    Hash,
    LedgerEntry,
    MemberAddedPayload,
    MemberRemovedPayload,
    PublicKey,
    RootKeyRotationPayload,
    SecretKey,
    UnsignedEntryFields,
    ValidationError,
    ValidationResult,
} from './types.js';
import { EntryType } from './types.js';
import type { PayloadMap } from './types.js';

// =============================================================================
// Deterministic Ordering
// =============================================================================

/**
 * Sort entries in deterministic total order.
 *
 * Primary: Lamport clock (ascending)
 * Tiebreaker 1: timestamp (ascending)
 * Tiebreaker 2: creatorDevicePubkey (lexicographic)
 * Tiebreaker 3: entryId (lexicographic)
 */
export function orderEntries(entries: LedgerEntry[]): LedgerEntry[] {
    return [...entries].sort((a, b) => {
        if (a.lamportClock !== b.lamportClock) return a.lamportClock - b.lamportClock;
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        if (a.creatorDevicePubkey !== b.creatorDevicePubkey) {
            return a.creatorDevicePubkey.localeCompare(b.creatorDevicePubkey);
        }
        return a.entryId.localeCompare(b.entryId);
    });
}

// =============================================================================
// Helper: membership & device checks
// =============================================================================

function isActiveMember(pubkey: PublicKey, state: GroupState): boolean {
    const member = state.members.get(pubkey);
    return member !== undefined && member.isActive;
}

function deviceBelongsToMember(
    devicePubkey: PublicKey,
    memberRootPubkey: PublicKey,
    state: GroupState,
): boolean {
    const member = state.members.get(memberRootPubkey);
    return member !== undefined && member.authorizedDevices.has(devicePubkey);
}

function findDeviceOwner(devicePubkey: PublicKey, state: GroupState): GroupMember | null {
    for (const member of state.members.values()) {
        if (member.authorizedDevices.has(devicePubkey)) {
            return member;
        }
    }
    return null;
}

// =============================================================================
// Entry Validation
// =============================================================================

/**
 * Validate a single ledger entry against the current chain and group state.
 */
export function validateEntry(
    entry: LedgerEntry,
    precedingEntries: LedgerEntry[],
    groupState: GroupState,
): ValidationResult {
    const errors: ValidationError[] = [];

    // ─── 1. Structural validation ───
    if (!entry.entryId) errors.push({ field: 'entryId', message: 'Missing entry_id' });
    if (entry.lamportClock < 0) errors.push({ field: 'lamportClock', message: 'Invalid lamport clock' });
    if (entry.timestamp <= 0) errors.push({ field: 'timestamp', message: 'Invalid timestamp' });
    if (!entry.creatorDevicePubkey) errors.push({ field: 'creatorDevicePubkey', message: 'Missing device pubkey' });
    if (!entry.signature) errors.push({ field: 'signature', message: 'Missing signature' });

    if (errors.length > 0) return { valid: false, errors };

    // ─── 2. Hash integrity ───
    const expectedId = computeEntryId({
        previousHash: entry.previousHash,
        lamportClock: entry.lamportClock,
        timestamp: entry.timestamp,
        entryType: entry.entryType,
        payload: entry.payload,
        creatorDevicePubkey: entry.creatorDevicePubkey,
    });
    if (expectedId !== entry.entryId) {
        errors.push({ field: 'entryId', message: 'Hash mismatch: content has been tampered with' });
    }

    // ─── 3. Signature verification ───
    if (!verifyEntrySignature(entry.entryId, entry.signature, entry.creatorDevicePubkey)) {
        errors.push({ field: 'signature', message: 'Invalid signature' });
    }

    // Early return if hash or signature invalid — no point checking further
    if (errors.length > 0) return { valid: false, errors };

    // ─── 4. Previous hash continuity ───
    if (entry.entryType === EntryType.Genesis) {
        if (entry.previousHash !== null) {
            errors.push({ field: 'previousHash', message: 'Genesis must have null previousHash' });
        }
        if (precedingEntries.length > 0) {
            errors.push({ field: 'entryType', message: 'Genesis must be the first entry' });
        }
    } else {
        if (entry.previousHash === null) {
            errors.push({ field: 'previousHash', message: 'Non-genesis entry must reference previous entry' });
        } else {
            const found = precedingEntries.some((e) => e.entryId === entry.previousHash);
            if (!found) {
                errors.push({ field: 'previousHash', message: 'previousHash references unknown entry' });
            }
        }
    }

    // ─── 5. Creator authorization ───
    validateCreatorAuthorization(entry, groupState, errors);

    // ─── 6. Type-specific payload validation ───
    validatePayload(entry, precedingEntries, groupState, errors);

    return { valid: errors.length === 0, errors };
}

// =============================================================================
// Creator Authorization
// =============================================================================

function validateCreatorAuthorization(
    entry: LedgerEntry,
    groupState: GroupState,
    errors: ValidationError[],
): void {
    if (entry.entryType === EntryType.Genesis) {
        // Genesis is self-authorizing
        return;
    }

    if (entry.entryType === EntryType.MemberAdded) {
        // MemberAdded is self-authorizing: the joiner's device isn't in
        // the group state yet. The invite token serves as authorization.
        return;
    }

    const owner = findDeviceOwner(entry.creatorDevicePubkey, groupState);
    if (!owner) {
        errors.push({
            field: 'creatorDevicePubkey',
            message: 'Device key not authorized by any active member',
        });
        return;
    }

    if (!owner.isActive) {
        errors.push({
            field: 'creatorDevicePubkey',
            message: `Device belongs to removed member: ${owner.rootPubkey}`,
        });
    }
}

// =============================================================================
// Payload Validation
// =============================================================================

function validatePayload(
    entry: LedgerEntry,
    precedingEntries: LedgerEntry[],
    groupState: GroupState,
    errors: ValidationError[],
): void {
    switch (entry.entryType) {
        case EntryType.Genesis:
            validateGenesisPayload(entry.payload, errors);
            break;
        case EntryType.ExpenseCreated:
            validateExpenseCreatedPayload(entry.payload, groupState, errors);
            break;
        case EntryType.ExpenseCorrection:
            validateExpenseCorrectionPayload(entry.payload, precedingEntries, groupState, errors);
            break;
        case EntryType.ExpenseVoided:
            validateExpenseVoidedPayload(entry.payload, precedingEntries, errors);
            break;
        case EntryType.MemberAdded:
            validateMemberAddedPayload(entry.payload, entry.timestamp, groupState, errors);
            break;
        case EntryType.MemberRemoved:
            validateMemberRemovedPayload(entry.payload, entry.creatorDevicePubkey, groupState, errors);
            break;
        case EntryType.DeviceAuthorized:
            validateDeviceAuthorizedPayload(entry.payload, entry.timestamp, groupState, errors);
            break;
        case EntryType.DeviceRevoked:
            validateDeviceRevokedPayload(entry.payload, groupState, errors);
            break;
        case EntryType.RootKeyRotation:
            validateRootKeyRotationPayload(entry.payload, groupState, errors);
            break;
    }
}

function validateExpenseVoidedPayload(
    payload: ExpenseVoidedPayload,
    precedingEntries: LedgerEntry[],
    errors: ValidationError[],
): void {
    const original = precedingEntries.find((e) => e.entryId === payload.voidedEntryId);
    if (!original) {
        errors.push({ field: 'payload.voidedEntryId', message: 'Voided entry not found' });
        return;
    }
    if (
        original.entryType !== EntryType.ExpenseCreated &&
        original.entryType !== EntryType.ExpenseCorrection
    ) {
        errors.push({ field: 'payload.voidedEntryId', message: 'Can only void expense entries' });
    }
}

function validateGenesisPayload(payload: GenesisPayload, errors: ValidationError[]): void {
    if (!payload.groupId) errors.push({ field: 'payload.groupId', message: 'Missing groupId' });
    if (!payload.groupName) errors.push({ field: 'payload.groupName', message: 'Missing groupName' });
    if (!payload.creatorRootPubkey) errors.push({ field: 'payload.creatorRootPubkey', message: 'Missing creator key' });
}

function validateExpenseCreatedPayload(
    payload: ExpenseCreatedPayload,
    state: GroupState,
    errors: ValidationError[],
): void {
    if (payload.amountMinorUnits <= 0) {
        errors.push({ field: 'payload.amountMinorUnits', message: 'Amount must be positive' });
    }
    if (!isActiveMember(payload.paidByRootPubkey, state)) {
        errors.push({ field: 'payload.paidByRootPubkey', message: 'Payer is not an active member' });
    }

    let total = 0;
    for (const [pubkey, share] of Object.entries(payload.splits)) {
        if (share < 0) {
            errors.push({ field: 'payload.splits', message: `Negative split for ${pubkey}` });
        }
        if (!isActiveMember(pubkey as PublicKey, state)) {
            errors.push({ field: 'payload.splits', message: `Split includes non-member: ${pubkey}` });
        }
        total += share;
    }
    if (total !== payload.amountMinorUnits) {
        errors.push({
            field: 'payload.splits',
            message: `Splits sum to ${total}, expected ${payload.amountMinorUnits}`,
        });
    }
}

function validateExpenseCorrectionPayload(
    payload: ExpenseCorrectionPayload,
    precedingEntries: LedgerEntry[],
    state: GroupState,
    errors: ValidationError[],
): void {
    const original = precedingEntries.find((e) => e.entryId === payload.referencedEntryId);
    if (!original) {
        errors.push({ field: 'payload.referencedEntryId', message: 'Referenced entry not found' });
        return;
    }
    if (original.entryType !== EntryType.ExpenseCreated && original.entryType !== EntryType.ExpenseCorrection) {
        errors.push({ field: 'payload.referencedEntryId', message: 'Can only correct expense entries' });
    }
    // Validate the corrected expense using the same rules
    validateExpenseCreatedPayload(payload.correctedExpense, state, errors);
}

function validateMemberAddedPayload(
    payload: MemberAddedPayload,
    entryTimestamp: number,
    state: GroupState,
    errors: ValidationError[],
): void {
    if (isActiveMember(payload.memberRootPubkey, state)) {
        errors.push({ field: 'payload.memberRootPubkey', message: 'Member already active' });
    }

    const token = payload.inviteToken;

    // Verify invite signature
    if (!verifyInviteSignature(token)) {
        errors.push({ field: 'payload.inviteToken', message: 'Invalid invite signature' });
    }

    // Verify inviter is active member
    if (!isActiveMember(token.inviterRootPubkey, state)) {
        errors.push({ field: 'payload.inviteToken', message: 'Inviter is not an active member' });
    }

    // Verify invite not expired (with 5-minute clock skew tolerance)
    const CLOCK_SKEW_MS = 5 * 60 * 1000;
    if (entryTimestamp > token.expiresAt + CLOCK_SKEW_MS) {
        errors.push({ field: 'payload.inviteToken', message: 'Invite has expired' });
    }

    // Verify group ID matches
    if (token.groupId !== state.groupId) {
        errors.push({ field: 'payload.inviteToken', message: 'Invite is for a different group' });
    }
}

function validateMemberRemovedPayload(
    payload: MemberRemovedPayload,
    creatorDevicePubkey: PublicKey,
    state: GroupState,
    errors: ValidationError[],
): void {
    if (!isActiveMember(payload.memberRootPubkey, state)) {
        errors.push({ field: 'payload.memberRootPubkey', message: 'Member not found or already removed' });
    }

    // Only the member themselves or the group creator can remove
    const isSelfRemoval = deviceBelongsToMember(creatorDevicePubkey, payload.memberRootPubkey, state);
    const isCreatorRemoval = deviceBelongsToMember(creatorDevicePubkey, state.creatorRootPubkey, state);
    if (!isSelfRemoval && !isCreatorRemoval) {
        errors.push({ field: 'creatorDevicePubkey', message: 'Unauthorized removal: only member or group creator can remove' });
    }
}

function validateDeviceAuthorizedPayload(
    payload: DeviceAuthorizedPayload,
    entryTimestamp: number,
    state: GroupState,
    errors: ValidationError[],
): void {
    if (!isActiveMember(payload.ownerRootPubkey, state)) {
        errors.push({ field: 'payload.ownerRootPubkey', message: 'Owner is not an active member' });
    }

    // Verify the authorization signature using the same canonical format
    // as createDeviceAuthorization in identity.ts.
    // Convention: authorizedAt must match the entry timestamp.
    if (!verifyDeviceAuthorization({
        devicePublicKey: payload.devicePublicKey,
        rootPublicKey: payload.ownerRootPubkey,
        deviceName: payload.deviceName,
        authorizedAt: entryTimestamp,
        authorizationSignature: payload.authorizationSignature,
    })) {
        errors.push({ field: 'payload.authorizationSignature', message: 'Device authorization signature is invalid' });
    }
}

function validateDeviceRevokedPayload(
    payload: DeviceRevokedPayload,
    state: GroupState,
    errors: ValidationError[],
): void {
    const member = state.members.get(payload.ownerRootPubkey);
    if (!member || !member.authorizedDevices.has(payload.devicePublicKey)) {
        errors.push({ field: 'payload.devicePublicKey', message: 'Device is not currently authorized' });
    }
}

function validateRootKeyRotationPayload(
    payload: RootKeyRotationPayload,
    state: GroupState,
    errors: ValidationError[],
): void {
    if (!isActiveMember(payload.previousRootPubkey, state)) {
        errors.push({ field: 'payload.previousRootPubkey', message: 'Previous root key is not an active member' });
    }

    // Count active members excluding the rotating member
    let activeCount = 0;
    for (const member of state.members.values()) {
        if (member.isActive && member.rootPubkey !== payload.previousRootPubkey) {
            activeCount++;
        }
    }
    const threshold = Math.floor(activeCount / 2) + 1;

    // Verify co-signatures
    let validSigs = 0;
    const seenSigners = new Set<PublicKey>();

    for (const cs of payload.coSignatures) {
        if (seenSigners.has(cs.signerRootPubkey)) continue; // no double-counting
        if (!isActiveMember(cs.signerRootPubkey, state)) continue;
        if (cs.signerRootPubkey === payload.previousRootPubkey) continue; // can't co-sign own recovery

        if (verifyRecoveryCoSignature(
            payload.previousRootPubkey,
            payload.newRootPubkey,
            state.groupId,
            cs.signerRootPubkey,
            cs.signature,
        )) {
            validSigs++;
            seenSigners.add(cs.signerRootPubkey);
        }
    }

    if (validSigs < threshold) {
        errors.push({
            field: 'payload.coSignatures',
            message: `Insufficient co-signatures: ${validSigs}/${threshold} required`,
        });
    }
}

// =============================================================================
// State Application
// =============================================================================

/**
 * Apply a validated entry to update group state.
 * Must only be called after successful validation.
 */
export function applyEntry(entry: LedgerEntry, state: GroupState): void {
    state.latestEntryHash = entry.entryId;
    state.currentLamportClock = Math.max(state.currentLamportClock, entry.lamportClock);

    switch (entry.entryType) {
        case EntryType.Genesis:
            applyGenesis(entry.payload, entry, state);
            break;
        case EntryType.MemberAdded:
            applyMemberAdded(entry.payload, entry, state);
            break;
        case EntryType.MemberRemoved:
            applyMemberRemoved(entry.payload, entry, state);
            break;
        case EntryType.DeviceAuthorized:
            applyDeviceAuthorized(entry.payload, state);
            break;
        case EntryType.DeviceRevoked:
            applyDeviceRevoked(entry.payload, state);
            break;
        case EntryType.RootKeyRotation:
            applyRootKeyRotation(entry.payload, state);
            break;
        // ExpenseCreated, ExpenseCorrection, and ExpenseVoided don't change membership state
        // Balances are recomputed separately via computeBalances()
    }
}

function applyGenesis(payload: GenesisPayload, entry: LedgerEntry, state: GroupState): void {
    state.groupId = payload.groupId;
    state.groupName = payload.groupName;
    state.creatorRootPubkey = payload.creatorRootPubkey;

    const member: GroupMember = {
        rootPubkey: payload.creatorRootPubkey,
        displayName: payload.creatorDisplayName,
        joinedAt: entry.timestamp,
        isActive: true,
        authorizedDevices: new Set([entry.creatorDevicePubkey]),
    };
    state.members.set(payload.creatorRootPubkey, member);
}

function applyMemberAdded(payload: MemberAddedPayload, entry: LedgerEntry, state: GroupState): void {
    const member: GroupMember = {
        rootPubkey: payload.memberRootPubkey,
        displayName: payload.memberDisplayName,
        joinedAt: entry.timestamp,
        isActive: true,
        // The device that created the MemberAdded entry is the joiner's first authorized device
        authorizedDevices: new Set([entry.creatorDevicePubkey]),
    };
    state.members.set(payload.memberRootPubkey, member);
}

function applyMemberRemoved(payload: MemberRemovedPayload, _entry: LedgerEntry, state: GroupState): void {
    const member = state.members.get(payload.memberRootPubkey);
    if (member) {
        member.isActive = false;
        member.removedAt = _entry.timestamp;
    }
}

function applyDeviceAuthorized(payload: DeviceAuthorizedPayload, state: GroupState): void {
    const member = state.members.get(payload.ownerRootPubkey);
    if (member) {
        member.authorizedDevices.add(payload.devicePublicKey);
    }
}

function applyDeviceRevoked(payload: DeviceRevokedPayload, state: GroupState): void {
    const member = state.members.get(payload.ownerRootPubkey);
    if (member) {
        member.authorizedDevices.delete(payload.devicePublicKey);
    }
}

function applyRootKeyRotation(payload: RootKeyRotationPayload, state: GroupState): void {
    const oldMember = state.members.get(payload.previousRootPubkey);
    if (!oldMember) return;

    // Create new member entry with the new root key, inheriting display name
    const newMember: GroupMember = {
        rootPubkey: payload.newRootPubkey,
        displayName: oldMember.displayName,
        joinedAt: oldMember.joinedAt,
        isActive: true,
        authorizedDevices: new Set(), // new root key must re-authorize devices
    };

    // Deactivate old member
    oldMember.isActive = false;

    state.members.set(payload.newRootPubkey, newMember);

    // Update creator reference if needed
    if (state.creatorRootPubkey === payload.previousRootPubkey) {
        state.creatorRootPubkey = payload.newRootPubkey;
    }
}

// =============================================================================
// Full Chain Validation
// =============================================================================

/**
 * Create a fresh empty group state for chain validation.
 */
export function createEmptyGroupState(): GroupState {
    return {
        groupId: '' as any,
        groupName: '',
        creatorRootPubkey: '' as any,
        members: new Map(),
        latestEntryHash: '' as any,
        currentLamportClock: 0,
        balances: new Map(),
    };
}

/**
 * Validate an entire chain from Genesis, replaying all entries.
 * Returns the final derived group state if valid.
 */
export function validateFullChain(entries: LedgerEntry[]): ChainValidationResult {
    const ordered = orderEntries(entries);
    const groupState = createEmptyGroupState();
    const allErrors: ValidationError[] = [];

    for (let i = 0; i < ordered.length; i++) {
        const entry = ordered[i]!;
        const preceding = ordered.slice(0, i);
        const result = validateEntry(entry, preceding, groupState);

        if (!result.valid) {
            for (const err of result.errors) {
                allErrors.push({
                    field: `entry[${i}].${err.field ?? ''}`,
                    message: `Entry ${entry.entryId.slice(0, 8)}...: ${err.message}`,
                });
            }
        } else {
            applyEntry(entry, groupState);
        }
    }

    // Recompute balances from the full chain
    if (allErrors.length === 0) {
        groupState.balances = computeBalances(ordered);
    }

    return {
        valid: allErrors.length === 0,
        errors: allErrors,
        finalState: allErrors.length === 0 ? groupState : null,
    };
}

// =============================================================================
// Entry Building
// =============================================================================

/**
 * Build a complete ledger entry: compute hash, sign, and return.
 */
export function buildEntry<T extends EntryType>(
    entryType: T,
    payload: PayloadMap[T],
    previousHash: Hash | null,
    lamportClock: number,
    creatorDevicePubkey: PublicKey,
    deviceSecretKey: SecretKey,
    timestamp: number = Date.now(),
): LedgerEntry {
    const fields: UnsignedEntryFields = {
        previousHash,
        lamportClock,
        timestamp,
        entryType,
        payload,
        creatorDevicePubkey,
    };

    const entryId = computeEntryId(fields);
    const signature = signEntryId(entryId, deviceSecretKey);

    return {
        entryId,
        previousHash,
        lamportClock,
        timestamp,
        entryType,
        payload,
        creatorDevicePubkey,
        signature,
    } as LedgerEntry;
}
