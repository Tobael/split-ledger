import { v4 as uuidv4 } from 'uuid';

import { generateRandomBytes, hash } from '../crypto.js';
import type { Ed25519KeyPair } from '../types.js';
import { validateAuthorizationV2, type ExpenseEditPolicyV2 } from './authorization.js';
import { createInviteV2, type EncryptedInviteV2 } from './invite.js';
import { signOperationV2 } from './operation.js';
import type { ExpenseDataV2, OperationPayloadV2, SignedOperationV2 } from './schemas.js';

export interface CommandContextV2 {
    history: readonly unknown[];
    actor: Ed25519KeyPair;
    createdAt?: number;
}

export interface CreateGroupCommandV2 {
    groupName: string;
    creatorDisplayName: string;
    creator: Ed25519KeyPair;
    groupId?: string;
    creatorParticipantId?: string;
    expenseEditPolicy?: ExpenseEditPolicyV2;
    createdAt?: number;
}

export interface AppendCommandV2 {
    history: readonly unknown[];
    actor: Ed25519KeyPair;
    payload: Exclude<OperationPayloadV2, { type: 'GroupCreated' }>;
    createdAt?: number;
}

function append(
    context: CommandContextV2,
    payload: Exclude<OperationPayloadV2, { type: 'GroupCreated' }>,
): SignedOperationV2 {
    return appendCommandV2({ ...context, payload });
}

export interface IssueClaimCapabilityCommandV2 {
    history: readonly unknown[];
    actor: Ed25519KeyPair;
    scope?: 'targeted' | 'any-unclaimed-slot';
    participantId?: string;
    capabilityId?: string;
    displayExpiresAt?: number;
    createdAt?: number;
}

export interface IssuedClaimCapabilityV2 {
    operation: SignedOperationV2;
    claimSecret: string;
}

export interface IssueEncryptedInviteCommandV2 extends IssueClaimCapabilityCommandV2 {
    joinBaseUrl: string;
    relayUrl: string;
    relayGroupCapability: string;
    groupSecret: string;
}

export interface IssuedEncryptedInviteV2 extends IssuedClaimCapabilityV2 {
    invite: EncryptedInviteV2;
}

function base64UrlEncode(bytes: Uint8Array): string {
    let base64: string;
    if (typeof Buffer !== 'undefined') base64 = Buffer.from(bytes).toString('base64');
    else base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function currentFrontier(operations: readonly SignedOperationV2[]): SignedOperationV2[] {
    const referenced = new Set(operations.flatMap(({ parents }) => parents));
    return operations.filter(({ operationId }) => !referenced.has(operationId));
}

export function createGroupCommandV2(command: CreateGroupCommandV2): SignedOperationV2 {
    const operation = signOperationV2({
        protocolVersion: 2,
        groupId: command.groupId ?? uuidv4(),
        parents: [],
        lamportClock: 0,
        createdAt: command.createdAt ?? Date.now(),
        actorPublicKey: command.creator.publicKey,
        payload: {
            type: 'GroupCreated',
            groupName: command.groupName,
            creatorParticipantId: command.creatorParticipantId ?? uuidv4(),
            creatorDisplayName: command.creatorDisplayName,
            expenseEditPolicy: command.expenseEditPolicy,
        },
    }, command.creator.secretKey);
    validateAuthorizationV2([operation]);
    return operation;
}

/** Build, sign, and authorize one operation against the current full frontier. */
export function appendCommandV2(command: AppendCommandV2): SignedOperationV2 {
    const accepted = validateAuthorizationV2(command.history);
    const frontier = currentFrontier(accepted);
    const operation = signOperationV2({
        protocolVersion: 2,
        groupId: accepted[0]!.groupId,
        parents: frontier.map(({ operationId }) => operationId).sort(),
        lamportClock: Math.max(...frontier.map(({ lamportClock }) => lamportClock)) + 1,
        createdAt: command.createdAt ?? Date.now(),
        actorPublicKey: command.actor.publicKey,
        payload: command.payload,
    }, command.actor.secretKey);
    validateAuthorizationV2([...accepted, operation]);
    return operation;
}

/** Issue a capability while keeping its bearer secret outside signed group history. */
export function issueClaimCapabilityCommandV2(
    command: IssueClaimCapabilityCommandV2,
): IssuedClaimCapabilityV2 {
    const scope = command.scope ?? 'targeted';
    if ((scope === 'targeted') !== Boolean(command.participantId)) {
        throw new Error('Targeted claim capabilities require exactly one participant ID');
    }
    const secretBytes = generateRandomBytes(32);
    const claimSecret = base64UrlEncode(secretBytes);
    const operation = appendCommandV2({
        history: command.history,
        actor: command.actor,
        createdAt: command.createdAt,
        payload: {
            type: 'ClaimCapabilityIssued',
            capabilityId: command.capabilityId ?? uuidv4(),
            scope,
            participantId: command.participantId,
            secretCommitment: hash(secretBytes),
            displayExpiresAt: command.displayExpiresAt,
        },
    });
    return { operation, claimSecret };
}

export function issueEncryptedInviteCommandV2(
    command: IssueEncryptedInviteCommandV2,
): IssuedEncryptedInviteV2 {
    const issued = issueClaimCapabilityCommandV2(command);
    if (issued.operation.payload.type !== 'ClaimCapabilityIssued') {
        throw new Error('Unexpected claim capability operation');
    }
    const invite = createInviteV2({
        protocolVersion: 2,
        groupId: issued.operation.groupId,
        relayUrl: command.relayUrl,
        relayGroupCapability: command.relayGroupCapability,
        groupSecret: command.groupSecret,
        scope: issued.operation.payload.scope,
        participantId: command.participantId,
        capabilityId: issued.operation.payload.capabilityId,
        claimSecret: issued.claimSecret,
        issueOperationId: issued.operation.operationId,
        displayExpiresAt: command.displayExpiresAt,
    }, command.joinBaseUrl);
    return { ...issued, invite };
}

export function authorizeDeviceCommandV2(
    context: CommandContextV2,
    devicePublicKey: string,
    deviceName: string,
): SignedOperationV2 {
    return append(context, {
        type: 'DeviceAuthorized', ownerRootPublicKey: context.actor.publicKey,
        devicePublicKey, deviceName,
    });
}

export function revokeDeviceCommandV2(
    context: CommandContextV2,
    ownerRootPublicKey: string,
    devicePublicKey: string,
    reason?: string,
): SignedOperationV2 {
    return append(context, { type: 'DeviceRevoked', ownerRootPublicKey, devicePublicKey, reason });
}

export function createParticipantSlotCommandV2(
    context: CommandContextV2,
    displayName: string,
    participantId: string = uuidv4(),
): SignedOperationV2 {
    return append(context, { type: 'ParticipantSlotCreated', participantId, displayName });
}

export function renameParticipantSlotCommandV2(
    context: CommandContextV2,
    participantId: string,
    displayName: string,
): SignedOperationV2 {
    return append(context, { type: 'ParticipantSlotRenamed', participantId, displayName });
}

export function disableParticipantSlotCommandV2(
    context: CommandContextV2,
    participantId: string,
    reason?: string,
): SignedOperationV2 {
    return append(context, { type: 'ParticipantSlotDisabled', participantId, reason });
}

export function resetParticipantSlotCommandV2(
    context: CommandContextV2,
    participantId: string,
    reason?: string,
): SignedOperationV2 {
    return append(context, { type: 'ParticipantSlotReset', participantId, reason });
}

export function revokeClaimCapabilityCommandV2(
    context: CommandContextV2,
    capabilityId: string,
): SignedOperationV2 {
    return append(context, { type: 'ClaimCapabilityRevoked', capabilityId });
}

export function claimParticipantSlotCommandV2(
    context: CommandContextV2,
    capabilityId: string,
    participantId: string,
    claimSecret: string,
): SignedOperationV2 {
    return append(context, {
        type: 'ParticipantSlotClaimed', capabilityId, participantId,
        claimantRootPublicKey: context.actor.publicKey, claimSecret,
    });
}

export function createExpenseCommandV2(
    context: CommandContextV2,
    expense: ExpenseDataV2,
    expenseId: string = uuidv4(),
): SignedOperationV2 {
    return append(context, { type: 'ExpenseCreated', expenseId, expense });
}

export function correctExpenseCommandV2(
    context: CommandContextV2,
    expenseId: string,
    expense: ExpenseDataV2,
    reason: string,
): SignedOperationV2 {
    return append(context, { type: 'ExpenseCorrected', expenseId, expense, reason });
}

export function voidExpenseCommandV2(
    context: CommandContextV2,
    expenseId: string,
    reason?: string,
): SignedOperationV2 {
    return append(context, { type: 'ExpenseVoided', expenseId, reason });
}

export function createSettlementCommandV2(
    context: CommandContextV2,
    from: string,
    to: string,
    amountMinorUnits: number,
    currency: string,
    settlementId: string = uuidv4(),
): SignedOperationV2 {
    return append(context, {
        type: 'SettlementCreated', settlementId, from, to, amountMinorUnits, currency,
    });
}
