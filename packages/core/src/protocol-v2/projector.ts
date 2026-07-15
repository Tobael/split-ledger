import {
    validateAuthorizationV2,
} from './authorization.js';
import type { ExpenseDataV2, OperationPayloadV2, SignedOperationV2 } from './schemas.js';

export interface ProjectionOperationV2 {
    operationId: string;
    lamportClock: number;
    payload: Pick<OperationPayloadV2, 'type'> & Record<string, unknown>;
}

export interface ParticipantClaimProjectionV2 {
    participantId: string;
    claimedRootPublicKey: string;
    winningOperationId: string;
}

export interface EffectiveExpenseProjectionV2 {
    expenseId: string;
    status: 'effective';
    effectiveOperationId: string;
    expense: Record<string, unknown>;
}

export interface VoidedExpenseProjectionV2 {
    expenseId: string;
    status: 'void';
    voidOperationId: string;
}

export type ExpenseProjectionV2 = EffectiveExpenseProjectionV2 | VoidedExpenseProjectionV2;

export interface ParticipantStateV2 {
    participantId: string;
    displayName: string;
    status: 'unclaimed' | 'claimed' | 'disabled';
    claimedRootPublicKey?: string;
}

export interface CapabilityStateV2 {
    capabilityId: string;
    scope: 'targeted' | 'any-unclaimed-slot';
    participantId?: string;
    secretCommitment: string;
    displayExpiresAt?: number;
    status: 'active' | 'consumed' | 'revoked';
}

export interface DeviceStateV2 {
    devicePublicKey: string;
    ownerRootPublicKey: string;
    deviceName: string;
    status: 'active' | 'revoked';
}

export interface SettlementStateV2 {
    settlementId: string;
    from: string;
    to: string;
    amountMinorUnits: number;
    currency: string;
    operationId: string;
}

export interface GroupStateV2 {
    protocolVersion: 2;
    groupId: string;
    groupName: string;
    creatorParticipantId: string;
    participants: Record<string, ParticipantStateV2>;
    capabilities: Record<string, CapabilityStateV2>;
    devices: Record<string, DeviceStateV2>;
    expenses: Record<string, ExpenseProjectionV2>;
    settlements: Record<string, SettlementStateV2>;
    balances: Record<string, Record<string, number>>;
    frontier: string[];
    operationCount: number;
}

function compareTuple(a: ProjectionOperationV2, b: ProjectionOperationV2): number {
    return a.lamportClock - b.lamportClock || a.operationId.localeCompare(b.operationId);
}

export function projectParticipantClaimsV2(
    operations: readonly ProjectionOperationV2[],
): Map<string, ParticipantClaimProjectionV2> {
    const claims = new Map<string, ParticipantClaimProjectionV2>();
    const candidates = operations
        .filter(({ payload }) => payload.type === 'ParticipantSlotClaimed');
    candidates.sort(compareTuple);

    for (const operation of candidates) {
        const participantId = operation.payload.participantId as string;
        if (!claims.has(participantId)) {
            claims.set(participantId, {
                participantId,
                claimedRootPublicKey: operation.payload.claimantRootPublicKey as string,
                winningOperationId: operation.operationId,
            });
        }
    }
    return claims;
}

export function projectExpensesV2(
    operations: readonly ProjectionOperationV2[],
): Map<string, ExpenseProjectionV2> {
    const byExpense = new Map<string, ProjectionOperationV2[]>();
    for (const operation of operations) {
        if (!['ExpenseCreated', 'ExpenseCorrected', 'ExpenseVoided'].includes(operation.payload.type)) continue;
        const expenseId = operation.payload.expenseId as string;
        const entries = byExpense.get(expenseId) ?? [];
        entries.push(operation);
        byExpense.set(expenseId, entries);
    }

    const result = new Map<string, ExpenseProjectionV2>();
    for (const [expenseId, entries] of byExpense) {
        const voidOperations = entries
            .filter(({ payload }) => payload.type === 'ExpenseVoided');
        voidOperations.sort(compareTuple);
        const voidOperation = voidOperations[0];
        if (voidOperation) {
            result.set(expenseId, {
                expenseId,
                status: 'void',
                voidOperationId: voidOperation.operationId,
            });
            continue;
        }

        const effectiveEntries = entries
            .filter(({ payload }) => ['ExpenseCreated', 'ExpenseCorrected'].includes(payload.type));
        effectiveEntries.sort(compareTuple);
        const effective = effectiveEntries.at(-1);
        if (effective) {
            result.set(expenseId, {
                expenseId,
                status: 'effective',
                effectiveOperationId: effective.operationId,
                expense: effective.payload.expense as Record<string, unknown>,
            });
        }
    }
    return result;
}

function addBalance(
    balances: Record<string, Record<string, number>>,
    currency: string,
    participantId: string,
    amount: number,
): void {
    const currencyBalances = balances[currency] ?? {};
    currencyBalances[participantId] = (currencyBalances[participantId] ?? 0) + amount;
    balances[currency] = currencyBalances;
}

/** Project operations that have already passed full v2 authorization. */
export function projectGroupStateV2(operations: readonly SignedOperationV2[]): GroupStateV2 {
    const ordered = [...operations].sort(compareTuple);
    const root = ordered[0];
    if (!root || root.payload.type !== 'GroupCreated') {
        throw new Error('Group state projection requires a GroupCreated root');
    }

    const participants: Record<string, ParticipantStateV2> = {
        [root.payload.creatorParticipantId]: {
            participantId: root.payload.creatorParticipantId,
            displayName: root.payload.creatorDisplayName,
            status: 'claimed',
            claimedRootPublicKey: root.actorPublicKey,
        },
    };
    const capabilities: Record<string, CapabilityStateV2> = {};
    const devices: Record<string, DeviceStateV2> = {};
    const settlements: Record<string, SettlementStateV2> = {};

    for (const operation of ordered) {
        const payload = operation.payload;
        if (payload.type === 'ParticipantSlotCreated' && !participants[payload.participantId]) {
            participants[payload.participantId] = {
                participantId: payload.participantId,
                displayName: payload.displayName,
                status: 'unclaimed',
            };
        } else if (payload.type === 'ParticipantSlotRenamed') {
            const participant = participants[payload.participantId];
            if (participant) participant.displayName = payload.displayName;
        } else if (payload.type === 'ParticipantSlotDisabled') {
            const participant = participants[payload.participantId];
            if (participant) participant.status = 'disabled';
        } else if (payload.type === 'ParticipantSlotReset') {
            const participant = participants[payload.participantId];
            if (participant) {
                participant.status = 'unclaimed';
                delete participant.claimedRootPublicKey;
            }
        } else if (payload.type === 'ClaimCapabilityIssued' && !capabilities[payload.capabilityId]) {
            capabilities[payload.capabilityId] = {
                capabilityId: payload.capabilityId,
                scope: payload.scope,
                participantId: payload.participantId,
                secretCommitment: payload.secretCommitment,
                displayExpiresAt: payload.displayExpiresAt,
                status: 'active',
            };
        } else if (payload.type === 'ClaimCapabilityRevoked') {
            const capability = capabilities[payload.capabilityId];
            if (capability) capability.status = 'revoked';
        } else if (payload.type === 'ParticipantSlotClaimed') {
            const participant = participants[payload.participantId];
            const capability = capabilities[payload.capabilityId];
            if (participant?.status === 'unclaimed' && capability?.status === 'active') {
                participant.status = 'claimed';
                participant.claimedRootPublicKey = payload.claimantRootPublicKey;
                capability.status = 'consumed';
            }
        } else if (payload.type === 'DeviceAuthorized' && !devices[payload.devicePublicKey]) {
            devices[payload.devicePublicKey] = {
                devicePublicKey: payload.devicePublicKey,
                ownerRootPublicKey: payload.ownerRootPublicKey,
                deviceName: payload.deviceName,
                status: 'active',
            };
        } else if (payload.type === 'DeviceRevoked') {
            const device = devices[payload.devicePublicKey];
            if (device) device.status = 'revoked';
        } else if (payload.type === 'SettlementCreated' && !settlements[payload.settlementId]) {
            settlements[payload.settlementId] = {
                settlementId: payload.settlementId,
                from: payload.from,
                to: payload.to,
                amountMinorUnits: payload.amountMinorUnits,
                currency: payload.currency,
                operationId: operation.operationId,
            };
        }
    }

    const expenses = Object.fromEntries(projectExpensesV2(ordered));
    const balances: Record<string, Record<string, number>> = {};
    for (const expenseState of Object.values(expenses)) {
        if (expenseState.status !== 'effective') continue;
        const expense = expenseState.expense as ExpenseDataV2;
        addBalance(balances, expense.currency, expense.paidBy, expense.amountMinorUnits);
        for (const [participantId, share] of Object.entries(expense.splits)) {
            addBalance(balances, expense.currency, participantId, -share);
        }
    }
    for (const settlement of Object.values(settlements)) {
        addBalance(balances, settlement.currency, settlement.from, settlement.amountMinorUnits);
        addBalance(balances, settlement.currency, settlement.to, -settlement.amountMinorUnits);
    }

    const parentIds = new Set(ordered.flatMap(({ parents }) => parents));
    const frontier = ordered
        .map(({ operationId }) => operationId)
        .filter((operationId) => !parentIds.has(operationId))
        .sort();

    return {
        protocolVersion: 2,
        groupId: root.groupId,
        groupName: root.payload.groupName,
        creatorParticipantId: root.payload.creatorParticipantId,
        participants,
        capabilities,
        devices,
        expenses,
        settlements,
        balances,
        frontier,
        operationCount: ordered.length,
    };
}

/** Validate untrusted operations and derive their complete group state. */
export function deriveGroupStateV2(
    values: readonly unknown[],
): GroupStateV2 {
    return projectGroupStateV2(validateAuthorizationV2(values));
}
