// =============================================================================
// SplitLedger — Recovery Manager
// =============================================================================
//
// Orchestrates the social recovery ceremony: initiate recovery (generate new
// root key), collect co-signatures from group members, and finalize with a
// RootKeyRotation ledger entry.
//

import type {
    Ed25519KeyPair,
    GroupId,
    GroupState,
    LedgerEntry,
    PublicKey,
    StorageAdapter,
    DeviceIdentity,
    CoSignature,
} from './types.js';
import { EntryType } from './types.js';
import { generateKeyPair } from './crypto.js';
import {
    createRecoveryCoSignature,
    verifyRecoveryCoSignature,
} from './identity.js';
import {
    buildEntry,
    orderEntries,
    validateFullChain,
} from './ledger.js';

// ─── Types ───

export interface RecoveryRequest {
    groupId: GroupId;
    previousRootPubkey: PublicKey;
    newRootPubkey: PublicKey;
    newRootKeyPair: Ed25519KeyPair;
    createdAt: number;
}

export interface RecoveryManagerOptions {
    storage: StorageAdapter;
    deviceIdentity: DeviceIdentity;
    rootKeyPair?: Ed25519KeyPair;
}

// ─── RecoveryManager ───

export class RecoveryManager {
    private storage: StorageAdapter;
    private device: DeviceIdentity;
    private rootKeyPair: Ed25519KeyPair | null;

    constructor(options: RecoveryManagerOptions) {
        this.storage = options.storage;
        this.device = options.deviceIdentity;
        this.rootKeyPair = options.rootKeyPair ?? null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Initiate Recovery
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Start a recovery ceremony by generating a new root key pair.
     * The recovery request must be shared with group members out-of-band
     * so they can create co-signatures.
     *
     * @param groupId - The group to recover the root key in
     * @param previousRootPubkey - The root public key being replaced
     *                             (defaults to the device's rootPublicKey)
     */
    initiateRecovery(groupId: GroupId, previousRootPubkey?: PublicKey): RecoveryRequest {
        const newRootKeyPair = generateKeyPair();
        const prevPubkey = previousRootPubkey ?? this.device.rootPublicKey;

        return {
            groupId,
            previousRootPubkey: prevPubkey,
            newRootPubkey: newRootKeyPair.publicKey,
            newRootKeyPair,
            createdAt: Date.now(),
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Co-Signing
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Create a co-signature for another member's recovery request.
     * Called by a helper member who wants to endorse the key rotation.
     *
     * @param request - The recovery request to co-sign
     * @returns A CoSignature to send back to the requesting member
     */
    createCoSignature(request: RecoveryRequest): CoSignature {
        if (!this.rootKeyPair) {
            throw new Error('Root key pair required to create co-signatures');
        }

        return createRecoveryCoSignature(
            request.previousRootPubkey,
            request.newRootPubkey,
            request.groupId,
            this.rootKeyPair.secretKey,
            this.rootKeyPair.publicKey,
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Complete Recovery
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Finalize the recovery ceremony by building and appending a
     * RootKeyRotation entry, after verifying that enough valid
     * co-signatures have been collected.
     *
     * @param request - The original recovery request
     * @param coSignatures - Co-signatures collected from group members
     * @returns The RootKeyRotation ledger entry
     */
    async completeRecovery(
        request: RecoveryRequest,
        coSignatures: CoSignature[],
    ): Promise<LedgerEntry> {
        const state = await this.deriveGroupState(request.groupId);

        // Verify the previous root pubkey is an active member
        const member = state.members.get(request.previousRootPubkey);
        if (!member || !member.isActive) {
            throw new Error('Cannot recover: previous root key is not an active member');
        }

        // Compute threshold
        const threshold = this.computeThreshold(state, request.previousRootPubkey);

        // Validate and count co-signatures
        const validCoSignatures = this.validateCoSignatures(
            request,
            coSignatures,
            state,
        );

        if (validCoSignatures.length < threshold) {
            throw new Error(
                `Insufficient co-signatures: got ${validCoSignatures.length}, need ${threshold}`,
            );
        }

        // Build the RootKeyRotation entry
        const entries = await this.storage.getAllEntries(request.groupId);
        const ordered = orderEntries([...entries]);
        const latestEntry = ordered[ordered.length - 1]!;

        const entry = buildEntry(
            EntryType.RootKeyRotation,
            {
                previousRootPubkey: request.previousRootPubkey,
                newRootPubkey: request.newRootPubkey,
                coSignatures: validCoSignatures,
            },
            latestEntry.entryId,
            state.currentLamportClock + 1,
            this.device.deviceKeyPair.publicKey,
            this.device.deviceKeyPair.secretKey,
        );

        await this.storage.appendEntry(request.groupId, entry);
        return entry;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Queries
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get the recovery threshold for a group.
     * threshold = floor((active_members - 1) / 2) + 1
     *
     * The "-1" is because the recovering member cannot co-sign for themselves.
     *
     * @param groupId - The group to check
     * @param recoveringMember - The member being recovered (excluded from count)
     */
    async getRecoveryThreshold(
        groupId: GroupId,
        recoveringMember: PublicKey,
    ): Promise<number> {
        const state = await this.deriveGroupState(groupId);
        return this.computeThreshold(state, recoveringMember);
    }

    // ─── Private Helpers ───

    private computeThreshold(state: GroupState, excludeMember: PublicKey): number {
        let activeCount = 0;
        for (const m of state.members.values()) {
            if (m.isActive && m.rootPubkey !== excludeMember) {
                activeCount++;
            }
        }
        return Math.floor(activeCount / 2) + 1;
    }

    private validateCoSignatures(
        request: RecoveryRequest,
        coSignatures: CoSignature[],
        state: GroupState,
    ): CoSignature[] {
        const valid: CoSignature[] = [];
        const seenSigners = new Set<PublicKey>();

        for (const cs of coSignatures) {
            // No duplicates
            if (seenSigners.has(cs.signerRootPubkey)) continue;

            // Can't co-sign own recovery
            if (cs.signerRootPubkey === request.previousRootPubkey) continue;

            // Must be an active member
            if (!state.members.get(cs.signerRootPubkey)?.isActive) continue;

            // Verify signature
            if (!verifyRecoveryCoSignature(
                request.previousRootPubkey,
                request.newRootPubkey,
                request.groupId,
                cs.signerRootPubkey,
                cs.signature,
            )) continue;

            valid.push(cs);
            seenSigners.add(cs.signerRootPubkey);
        }

        return valid;
    }

    private async deriveGroupState(groupId: GroupId): Promise<GroupState> {
        const entries = await this.storage.getAllEntries(groupId);
        if (entries.length === 0) {
            throw new Error(`No entries found for group ${groupId}`);
        }

        const result = validateFullChain(entries);
        if (!result.valid || !result.finalState) {
            throw new Error(`Invalid ledger chain: ${result.errors.map((e) => e.message).join(', ')}`);
        }

        return result.finalState;
    }
}
