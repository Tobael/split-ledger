import { hash } from '../crypto.js';
import { validateOperationGraphV2 } from './graph.js';
import type { SignedOperationV2 } from './schemas.js';

interface SlotState {
    participantId: string;
    disabled: boolean;
    claimedRootPublicKey?: string;
}

function base64UrlDecode(value: string): Uint8Array {
    let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let index = 0; index < a.length; index += 1) {
        difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }
    return difference === 0;
}

function causalOperations(
    operation: SignedOperationV2,
    byId: ReadonlyMap<string, SignedOperationV2>,
    ancestorsById: ReadonlyMap<string, ReadonlySet<string>>,
): SignedOperationV2[] {
    const ids = new Set<string>();
    for (const parentId of operation.parents) {
        ids.add(parentId);
        for (const ancestorId of ancestorsById.get(parentId) ?? []) ids.add(ancestorId);
    }
    return [...ids].map((id) => byId.get(id)!).sort((a, b) =>
        a.lamportClock - b.lamportClock || a.operationId.localeCompare(b.operationId));
}

function projectSlots(operations: readonly SignedOperationV2[]): Map<string, SlotState> {
    const root = operations.find(({ payload }) => payload.type === 'GroupCreated');
    const slots = new Map<string, SlotState>();
    if (root?.payload.type === 'GroupCreated') {
        slots.set(root.payload.creatorParticipantId, {
            participantId: root.payload.creatorParticipantId,
            disabled: false,
            claimedRootPublicKey: root.actorPublicKey,
        });
    }
    for (const operation of operations) {
        const payload = operation.payload;
        if (payload.type === 'ParticipantSlotCreated') {
            slots.set(payload.participantId, { participantId: payload.participantId, disabled: false });
        } else if (payload.type === 'ParticipantSlotDisabled') {
            const slot = slots.get(payload.participantId);
            if (slot) slot.disabled = true;
        } else if (payload.type === 'ParticipantSlotReset') {
            const slot = slots.get(payload.participantId);
            if (slot) delete slot.claimedRootPublicKey;
        } else if (payload.type === 'ParticipantSlotClaimed') {
            const slot = slots.get(payload.participantId);
            if (slot && !slot.claimedRootPublicKey) {
                slot.claimedRootPublicKey = payload.claimantRootPublicKey;
            }
        }
    }
    return slots;
}

function creatorKeyIsActive(actor: string, creatorRoot: string, causal: readonly SignedOperationV2[]): boolean {
    if (actor === creatorRoot) return true;
    const authorized = causal.some(({ payload }) =>
        payload.type === 'DeviceAuthorized'
        && payload.ownerRootPublicKey === creatorRoot
        && payload.devicePublicKey === actor);
    const revoked = causal.some(({ payload }) =>
        payload.type === 'DeviceRevoked'
        && payload.ownerRootPublicKey === creatorRoot
        && payload.devicePublicKey === actor);
    return authorized && !revoked;
}

function assertMembershipAuthorized(
    operation: SignedOperationV2,
    causal: readonly SignedOperationV2[],
    creatorRoot: string,
    creatorParticipantId: string,
): void {
    const payload = operation.payload;
    const slots = projectSlots(causal);
    const creatorAuthorized = creatorKeyIsActive(operation.actorPublicKey, creatorRoot, causal);
    const requireCreator = () => {
        if (!creatorAuthorized) throw new Error(`Creator authorization required for ${payload.type}`);
    };

    if (payload.type === 'ParticipantSlotCreated') {
        requireCreator();
        if (slots.has(payload.participantId)) throw new Error('Participant slot already exists');
    } else if (payload.type === 'ParticipantSlotRenamed') {
        requireCreator();
        const slot = slots.get(payload.participantId);
        if (!slot || slot.disabled) throw new Error('Active participant slot required');
    } else if (payload.type === 'ParticipantSlotDisabled') {
        requireCreator();
        if (payload.participantId === creatorParticipantId) throw new Error('Creator slot cannot be disabled');
        if (!slots.has(payload.participantId)) throw new Error('Participant slot does not exist');
    } else if (payload.type === 'ParticipantSlotReset') {
        requireCreator();
        const slot = slots.get(payload.participantId);
        if (!slot?.claimedRootPublicKey || payload.participantId === creatorParticipantId) {
            throw new Error('A claimed non-creator slot is required for reset');
        }
    } else if (payload.type === 'ClaimCapabilityIssued') {
        requireCreator();
        const slot = payload.participantId ? slots.get(payload.participantId) : undefined;
        const validTarget = payload.scope === 'targeted'
            && Boolean(slot && !slot.disabled && !slot.claimedRootPublicKey);
        const validGeneric = payload.scope === 'any-unclaimed-slot'
            && payload.participantId === undefined
            && [...slots.values()].some((candidate) => !candidate.disabled && !candidate.claimedRootPublicKey);
        if (!validTarget && !validGeneric) {
            throw new Error('An active unclaimed participant slot is required');
        }
    } else if (payload.type === 'ClaimCapabilityRevoked') {
        requireCreator();
        const issued = causal.some((entry) => entry.payload.type === 'ClaimCapabilityIssued'
            && entry.payload.capabilityId === payload.capabilityId);
        const ended = causal.some((entry) =>
            (entry.payload.type === 'ClaimCapabilityRevoked' || entry.payload.type === 'ParticipantSlotClaimed')
            && entry.payload.capabilityId === payload.capabilityId);
        if (!issued || ended) throw new Error('Active claim capability required');
    } else if (payload.type === 'ParticipantSlotClaimed') {
        if (operation.actorPublicKey !== payload.claimantRootPublicKey) {
            throw new Error('Slot claim must be signed by the claimant root');
        }
        const issue = causal.find((entry) => entry.payload.type === 'ClaimCapabilityIssued'
            && entry.payload.capabilityId === payload.capabilityId);
        if (!issue || issue.payload.type !== 'ClaimCapabilityIssued') {
            throw new Error('Causal claim capability required');
        }
        if (issue.payload.scope === 'targeted' && issue.payload.participantId !== payload.participantId) {
            throw new Error('Targeted claim capability does not allow this participant slot');
        }
        const slot = slots.get(payload.participantId);
        if (!slot || slot.disabled || slot.claimedRootPublicKey) {
            throw new Error('An active unclaimed participant slot is required for claim');
        }
        const latestReset = causal.filter((entry) => entry.payload.type === 'ParticipantSlotReset'
            && entry.payload.participantId === payload.participantId).at(-1);
        if (latestReset && (
            issue.lamportClock < latestReset.lamportClock
            || (issue.lamportClock === latestReset.lamportClock
                && issue.operationId.localeCompare(latestReset.operationId) <= 0)
        )) {
            throw new Error('Claim capability predates the latest participant slot reset');
        }
        const ended = causal.some((entry) =>
            (entry.payload.type === 'ClaimCapabilityRevoked' || entry.payload.type === 'ParticipantSlotClaimed')
            && entry.payload.capabilityId === payload.capabilityId);
        if (ended) throw new Error('Claim capability is no longer active');
        const commitment = hash(base64UrlDecode(payload.claimSecret));
        if (!constantTimeEqualHex(commitment, issue.payload.secretCommitment)) {
            throw new Error('Claim secret does not match capability commitment');
        }
    } else if (payload.type === 'DeviceAuthorized') {
        if (operation.actorPublicKey !== payload.ownerRootPublicKey) {
            throw new Error('Device authorization must be signed by its owner root');
        }
        const ownsSlot = [...slots.values()].some((slot) =>
            !slot.disabled && slot.claimedRootPublicKey === payload.ownerRootPublicKey);
        if (!ownsSlot) throw new Error('Device owner must control an active participant slot');
        const keyWasUsed = causal.some((entry) =>
            (entry.payload.type === 'DeviceAuthorized' || entry.payload.type === 'DeviceRevoked')
            && entry.payload.devicePublicKey === payload.devicePublicKey);
        if (keyWasUsed) throw new Error('A previously used device key cannot be re-authorized');
    } else if (payload.type === 'DeviceRevoked') {
        const actorIsOwner = operation.actorPublicKey === payload.ownerRootPublicKey;
        const actorIsOwnerDevice = creatorKeyIsActive(
            operation.actorPublicKey,
            payload.ownerRootPublicKey,
            causal,
        );
        if (!actorIsOwner && !actorIsOwnerDevice) throw new Error('Device revocation requires owner authority');
        const targetExists = causal.some((entry) => entry.payload.type === 'DeviceAuthorized'
            && entry.payload.ownerRootPublicKey === payload.ownerRootPublicKey
            && entry.payload.devicePublicKey === payload.devicePublicKey);
        if (!targetExists) throw new Error('Revoked device is not authorized');
    }
}

/** Validate membership and invitation authorization in each operation's causal parent state. */
export function validateMembershipAuthorizationV2(values: readonly unknown[]): SignedOperationV2[] {
    const ordered = validateOperationGraphV2(values);
    const root = ordered[0]!;
    if (root.payload.type !== 'GroupCreated') throw new Error('Invalid protocol v2 root');
    if (root.actorPublicKey.length !== 64) throw new Error('GroupCreated must be signed by its creator root');

    const byId = new Map(ordered.map((operation) => [operation.operationId, operation]));
    const ancestorsById = new Map<string, ReadonlySet<string>>();
    for (const operation of ordered) {
        const ancestors = new Set<string>();
        for (const parentId of operation.parents) {
            ancestors.add(parentId);
            for (const id of ancestorsById.get(parentId) ?? []) ancestors.add(id);
        }
        ancestorsById.set(operation.operationId, ancestors);
        if (operation === root) continue;
        assertMembershipAuthorized(
            operation,
            causalOperations(operation, byId, ancestorsById),
            root.actorPublicKey,
            root.payload.creatorParticipantId,
        );
    }
    return ordered;
}
