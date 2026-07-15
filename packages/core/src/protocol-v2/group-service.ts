import type { Ed25519KeyPair } from '../types.js';
import {
    authorizeDeviceCommandV2,
    claimParticipantSlotCommandV2,
    correctExpenseCommandV2,
    createExpenseCommandV2,
    createGroupCommandV2,
    createParticipantSlotCommandV2,
    createSettlementCommandV2,
    disableParticipantSlotCommandV2,
    issueEncryptedInviteCommandV2,
    renameParticipantSlotCommandV2,
    resetParticipantSlotCommandV2,
    revokeClaimCapabilityCommandV2,
    revokeDeviceCommandV2,
    voidExpenseCommandV2,
    type CreateGroupCommandV2,
    type IssueEncryptedInviteCommandV2,
    type IssuedEncryptedInviteV2,
} from './commands.js';
import { parseInviteV2 } from './invite.js';
import { deriveGroupStateV2, type GroupStateV2 } from './projector.js';
import { signedOperationV2Schema, type ExpenseDataV2, type SignedOperationV2 } from './schemas.js';
import type { OperationStorageV2 } from './storage.js';

type CreateStoredGroupV2 = Omit<CreateGroupCommandV2, 'creator'> & { creator: Ed25519KeyPair };
type IssueStoredInviteV2 = Omit<IssueEncryptedInviteCommandV2, 'history' | 'actor'> & {
    actor: Ed25519KeyPair;
};

/** Validated protocol-v2 application service over a durable operation set. */
export class GroupServiceV2 {
    constructor(private readonly storage: OperationStorageV2) {}

    async createGroup(command: CreateStoredGroupV2): Promise<GroupStateV2> {
        const operation = createGroupCommandV2(command);
        await this.storage.putOperation(operation);
        return deriveGroupStateV2([operation]);
    }

    async getOperations(groupId: string): Promise<SignedOperationV2[]> {
        return this.storage.getOperations(groupId);
    }

    async getGroupState(groupId: string): Promise<GroupStateV2 | null> {
        const history = await this.storage.getOperations(groupId);
        return history.length > 0 ? deriveGroupStateV2(history) : null;
    }

    async getGroupIds(): Promise<string[]> {
        return this.storage.getGroupIds();
    }

    async acceptOperations(groupId: string, values: readonly unknown[]): Promise<GroupStateV2> {
        const incoming = values.map((value) => signedOperationV2Schema.parse(value));
        if (incoming.some((operation) => operation.groupId !== groupId)) {
            throw new Error('Remote operation belongs to another group');
        }
        const local = await this.storage.getOperations(groupId);
        const union = new Map(local.map((operation) => [operation.operationId, operation]));
        for (const operation of incoming) union.set(operation.operationId, operation);
        const accepted = [...union.values()];
        const state = deriveGroupStateV2(accepted);
        for (const operation of incoming) await this.storage.putOperation(operation);
        return state;
    }

    async authorizeDevice(
        groupId: string,
        actor: Ed25519KeyPair,
        devicePublicKey: string,
        deviceName: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => authorizeDeviceCommandV2(
            { history, actor }, devicePublicKey, deviceName,
        ));
    }

    async createParticipantSlot(
        groupId: string,
        actor: Ed25519KeyPair,
        displayName: string,
        participantId?: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => createParticipantSlotCommandV2(
            { history, actor }, displayName, participantId,
        ));
    }

    async renameParticipantSlot(
        groupId: string,
        actor: Ed25519KeyPair,
        participantId: string,
        displayName: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => renameParticipantSlotCommandV2(
            { history, actor }, participantId, displayName,
        ));
    }

    async disableParticipantSlot(
        groupId: string,
        actor: Ed25519KeyPair,
        participantId: string,
        reason?: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => disableParticipantSlotCommandV2(
            { history, actor }, participantId, reason,
        ));
    }

    async resetParticipantSlot(
        groupId: string,
        actor: Ed25519KeyPair,
        participantId: string,
        reason?: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => resetParticipantSlotCommandV2(
            { history, actor }, participantId, reason,
        ));
    }

    async issueInviteForGroup(
        groupId: string,
        command: IssueStoredInviteV2,
    ): Promise<IssuedEncryptedInviteV2> {
        const history = await this.requireHistory(groupId);
        const issued = issueEncryptedInviteCommandV2({ ...command, history });
        await this.storage.putOperation(issued.operation);
        return issued;
    }

    async revokeInvite(groupId: string, actor: Ed25519KeyPair, capabilityId: string): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => revokeClaimCapabilityCommandV2(
            { history, actor }, capabilityId,
        ));
    }

    async claimInvite(
        actor: Ed25519KeyPair,
        inviteUrl: string,
        selectedParticipantId?: string,
    ): Promise<SignedOperationV2> {
        const invite = parseInviteV2(inviteUrl);
        const participantId = invite.scope === 'targeted' ? invite.participantId : selectedParticipantId;
        if (!participantId) throw new Error('A participant slot must be selected for a generic invite');
        return this.commit(invite.groupId, (history) => claimParticipantSlotCommandV2(
            { history, actor }, invite.capabilityId, participantId, invite.claimSecret,
        ));
    }

    async createExpense(
        groupId: string,
        actor: Ed25519KeyPair,
        expense: ExpenseDataV2,
        expenseId?: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => createExpenseCommandV2(
            { history, actor }, expense, expenseId,
        ));
    }

    async correctExpense(
        groupId: string,
        actor: Ed25519KeyPair,
        expenseId: string,
        expense: ExpenseDataV2,
        reason: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => correctExpenseCommandV2(
            { history, actor }, expenseId, expense, reason,
        ));
    }

    async voidExpense(
        groupId: string,
        actor: Ed25519KeyPair,
        expenseId: string,
        reason?: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => voidExpenseCommandV2(
            { history, actor }, expenseId, reason,
        ));
    }

    async createSettlement(
        groupId: string,
        actor: Ed25519KeyPair,
        from: string,
        to: string,
        amountMinorUnits: number,
        currency: string,
        settlementId?: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => createSettlementCommandV2(
            { history, actor }, from, to, amountMinorUnits, currency, settlementId,
        ));
    }

    async revokeDevice(
        groupId: string,
        actor: Ed25519KeyPair,
        ownerRootPublicKey: string,
        devicePublicKey: string,
        reason?: string,
    ): Promise<SignedOperationV2> {
        return this.commit(groupId, (history) => revokeDeviceCommandV2(
            { history, actor }, ownerRootPublicKey, devicePublicKey, reason,
        ));
    }

    async deleteGroup(groupId: string): Promise<void> {
        await this.storage.deleteGroup(groupId);
    }

    private async requireHistory(groupId: string): Promise<SignedOperationV2[]> {
        const history = await this.storage.getOperations(groupId);
        if (history.length === 0) throw new Error('Group history is unavailable');
        return history;
    }

    private async commit(
        groupId: string,
        build: (history: readonly SignedOperationV2[]) => SignedOperationV2,
    ): Promise<SignedOperationV2> {
        const history = await this.requireHistory(groupId);
        const operation = build(history);
        await this.storage.putOperation(operation);
        return operation;
    }
}
