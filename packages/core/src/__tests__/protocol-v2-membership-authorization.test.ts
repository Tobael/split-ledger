import { describe, expect, it } from 'vitest';

import { generateKeyPair, hash } from '../crypto.js';
import {
    projectParticipantClaimsV2,
    signOperationV2,
    validateMembershipAuthorizationV2,
    type OperationPayloadV2,
    type SignedOperationV2,
} from '../protocol-v2/index.js';
import type { Ed25519KeyPair } from '../types.js';

const groupId = '018cc251-f400-7000-8000-000000000001';
const creatorParticipantId = '018cc251-f400-7000-8000-000000000002';
const guestParticipantId = '018cc251-f400-7000-8000-000000000003';
const capabilityId = '018cc251-f400-7000-8000-000000000004';
const claimSecret = 'A'.repeat(43);
const secretCommitment = hash(new Uint8Array(32));

function root(creator: Ed25519KeyPair): SignedOperationV2 {
    return signOperationV2({
        protocolVersion: 2,
        groupId,
        parents: [],
        lamportClock: 0,
        createdAt: 1767225600000,
        actorPublicKey: creator.publicKey,
        payload: { type: 'GroupCreated', groupName: 'Trip', creatorParticipantId, creatorDisplayName: 'Alice' },
    }, creator.secretKey);
}

function child(
    parent: SignedOperationV2,
    payload: OperationPayloadV2,
    actor: Ed25519KeyPair,
): SignedOperationV2 {
    return signOperationV2({
        protocolVersion: 2,
        groupId,
        parents: [parent.operationId],
        lamportClock: parent.lamportClock + 1,
        createdAt: parent.createdAt + 1,
        actorPublicKey: actor.publicKey,
        payload,
    }, actor.secretKey);
}

function invitationHistory() {
    const creator = generateKeyPair();
    const group = root(creator);
    const slot = child(group, {
        type: 'ParticipantSlotCreated', participantId: guestParticipantId, displayName: 'Bob',
    }, creator);
    const issue = child(slot, {
        type: 'ClaimCapabilityIssued', capabilityId, scope: 'targeted', participantId: guestParticipantId, secretCommitment,
    }, creator);
    return { creator, group, slot, issue };
}

describe('protocol v2 membership authorization', () => {
    it('accepts a creator-issued targeted claim signed by its claimant', () => {
        const { group, slot, issue } = invitationHistory();
        const claimant = generateKeyPair();
        const claim = child(issue, {
            type: 'ParticipantSlotClaimed', capabilityId, participantId: guestParticipantId,
            claimantRootPublicKey: claimant.publicKey, claimSecret,
        }, claimant);

        const accepted = validateMembershipAuthorizationV2([claim, slot, group, issue]);
        expect(projectParticipantClaimsV2(accepted).get(guestParticipantId)?.claimedRootPublicKey)
            .toBe(claimant.publicKey);
    });

    it('rejects participant-slot administration by a non-creator', () => {
        const creator = generateKeyPair();
        const group = root(creator);
        const stranger = generateKeyPair();
        const slot = child(group, {
            type: 'ParticipantSlotCreated', participantId: guestParticipantId, displayName: 'Bob',
        }, stranger);
        expect(() => validateMembershipAuthorizationV2([group, slot])).toThrow('Creator');
    });

    it('rejects a claim with the wrong secret', () => {
        const { group, slot, issue } = invitationHistory();
        const claimant = generateKeyPair();
        const claim = child(issue, {
            type: 'ParticipantSlotClaimed', capabilityId, participantId: guestParticipantId,
            claimantRootPublicKey: claimant.publicKey, claimSecret: 'B'.repeat(43),
        }, claimant);
        expect(() => validateMembershipAuthorizationV2([group, slot, issue, claim]))
            .toThrow('secret');
    });

    it('rejects a claim causally after revocation', () => {
        const { creator, group, slot, issue } = invitationHistory();
        const revoke = child(issue, { type: 'ClaimCapabilityRevoked', capabilityId }, creator);
        const claimant = generateKeyPair();
        const claim = child(revoke, {
            type: 'ParticipantSlotClaimed', capabilityId, participantId: guestParticipantId,
            claimantRootPublicKey: claimant.publicKey, claimSecret,
        }, claimant);
        expect(() => validateMembershipAuthorizationV2([group, slot, issue, revoke, claim]))
            .toThrow('no longer active');
    });

    it('accepts concurrent valid claims and leaves deterministic ownership to projection', () => {
        const { group, slot, issue } = invitationHistory();
        const first = generateKeyPair();
        const second = generateKeyPair();
        const claims = [first, second].map((claimant) => child(issue, {
            type: 'ParticipantSlotClaimed', capabilityId, participantId: guestParticipantId,
            claimantRootPublicKey: claimant.publicKey, claimSecret,
        }, claimant));
        const accepted = validateMembershipAuthorizationV2([group, slot, issue, ...claims]);
        const expected = [...claims].sort((a, b) => a.operationId.localeCompare(b.operationId))[0]!;
        expect(projectParticipantClaimsV2(accepted).get(guestParticipantId)?.winningOperationId)
            .toBe(expected.operationId);
    });

    it('allows the creator to reset a claim and issue a replacement capability', () => {
        const { creator, group, slot, issue } = invitationHistory();
        const claimant = generateKeyPair();
        const claim = child(issue, {
            type: 'ParticipantSlotClaimed', capabilityId, participantId: guestParticipantId,
            claimantRootPublicKey: claimant.publicKey, claimSecret,
        }, claimant);
        const reset = child(claim, {
            type: 'ParticipantSlotReset', participantId: guestParticipantId,
            reason: 'Identity was lost',
        }, creator);
        const replacement = child(reset, {
            type: 'ClaimCapabilityIssued',
            capabilityId: '018cc251-f400-7000-8000-000000000005',
            scope: 'targeted',
            participantId: guestParticipantId,
            secretCommitment,
        }, creator);

        expect(validateMembershipAuthorizationV2([group, slot, issue, claim, reset, replacement]))
            .toHaveLength(6);
    });

    it('rejects an outstanding capability issued before a slot reset', () => {
        const { creator, group, slot, issue } = invitationHistory();
        const oldCapabilityId = '018cc251-f400-7000-8000-000000000006';
        const secondIssue = child(issue, {
            type: 'ClaimCapabilityIssued', capabilityId: oldCapabilityId, scope: 'targeted',
            participantId: guestParticipantId, secretCommitment,
        }, creator);
        const firstClaimant = generateKeyPair();
        const firstClaim = child(secondIssue, {
            type: 'ParticipantSlotClaimed', capabilityId, participantId: guestParticipantId,
            claimantRootPublicKey: firstClaimant.publicKey, claimSecret,
        }, firstClaimant);
        const reset = child(firstClaim, {
            type: 'ParticipantSlotReset', participantId: guestParticipantId,
        }, creator);
        const secondClaimant = generateKeyPair();
        const staleClaim = child(reset, {
            type: 'ParticipantSlotClaimed', capabilityId: oldCapabilityId,
            participantId: guestParticipantId, claimantRootPublicKey: secondClaimant.publicKey,
            claimSecret,
        }, secondClaimant);

        expect(() => validateMembershipAuthorizationV2([
            group, slot, issue, secondIssue, firstClaim, reset, staleClaim,
        ])).toThrow('predates');
    });
});
