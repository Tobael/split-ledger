import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
    createDeviceIdentity, createGroupAccessV2, createRootIdentity, GroupServiceV2, IdentitySyncService,
    InMemoryOperationStorageV2, type GroupAccessV2, type IdentityDirectoryRecord, type IdentitySyncStorage,
} from '@splitledger/core';
import { startRelay } from '../server.js';

class DeviceStore extends InMemoryOperationStorageV2 implements IdentitySyncStorage {
    private readonly access = new Map<string, GroupAccessV2>();
    private readonly records = new Map<string, IdentityDirectoryRecord>();
    async getGroupIds() { return [...new Set([...await super.getGroupIds(), ...this.access.keys()])]; }
    async storeGroupAccess(value: GroupAccessV2) { this.access.set(value.groupId, structuredClone(value)); }
    async getGroupAccess(id: string) { return this.access.get(id) ?? null; }
    async deleteGroupAccess(id: string) { this.access.delete(id); }
    async getDirectoryRecords(id: string) { return [...this.records.values()].filter((record) => record.directoryId === id); }
    async putDirectoryRecords(records: IdentityDirectoryRecord[]) { for (const record of records) this.records.set(record.recordId, record); }
    async isGroupHidden() { return false; }
}

describe('identity discovery through the real relay', () => {
    it('discovers a later group, converges after edits, and propagates revocation using encrypted paginated transport', async () => {
        vi.stubGlobal('WebSocket', WebSocket);
        const relay = startRelay({ port: 0, dbPath: join(tmpdir(), `identity-sync-${crypto.randomUUID()}.db`), admissionDifficultyBits: 8, pageSize: 2 });
        try {
            await new Promise((resolve) => setTimeout(resolve, 100));
            const address = relay.address();
            const host = address.host === '0.0.0.0' ? '127.0.0.1' : address.host;
            const url = `ws://${host}:${address.port}`;
            const root = createRootIdentity('Alice');
            const directoryAccess = createGroupAccessV2(crypto.randomUUID(), url);
            const phone = { rootKeyPair: root.rootKeyPair, directoryAccess, device: createDeviceIdentity(root.rootKeyPair, 'Phone') };
            const browser = { ...phone, device: createDeviceIdentity(root.rootKeyPair, 'Browser') };
            const phoneStore = new DeviceStore();
            const browserStore = new DeviceStore();
            const phoneSync = new IdentitySyncService(phoneStore, phone);
            const browserSync = new IdentitySyncService(browserStore, browser);
            expect((await phoneSync.synchronize()).errors.size).toBe(0);
            expect((await browserSync.synchronize()).errors.size).toBe(0);
            const phoneGroups = new GroupServiceV2(phoneStore);
            const group = await phoneGroups.createGroup({ creator: root.rootKeyPair, groupName: 'Created after enrollment', creatorDisplayName: 'Alice' });
            await phoneGroups.authorizeDevice(group.groupId, root.rootKeyPair, phone.device.deviceKeyPair.publicKey, 'Phone');
            await phoneStore.storeGroupAccess(createGroupAccessV2(group.groupId, url));
            expect((await phoneSync.synchronize()).errors.size).toBe(0);
            expect((await browserSync.synchronize()).errors.size).toBe(0);
            expect(await browserStore.getGroupIds()).toContain(group.groupId);
            const browserGroups = new GroupServiceV2(browserStore);
            const expense = { description: 'Lunch', amountMinorUnits: 1200, currency: 'EUR', paidBy: group.creatorParticipantId, splits: { [group.creatorParticipantId]: 1200 } };
            const created = await browserGroups.createExpense(group.groupId, browser.device.deviceKeyPair, expense);
            expect((await browserSync.synchronize()).errors.size).toBe(0);
            expect((await phoneSync.synchronize()).errors.size).toBe(0);
            if (created.payload.type !== 'ExpenseCreated') throw new Error('Expected expense');
            await phoneGroups.correctExpense(group.groupId, phone.device.deviceKeyPair, created.payload.expenseId, { ...expense, description: 'Corrected on phone' }, 'Correction');
            expect((await phoneSync.synchronize()).errors.size).toBe(0);
            expect((await browserSync.synchronize()).errors.size).toBe(0);
            expect(await phoneGroups.getGroupState(group.groupId)).toEqual(await browserGroups.getGroupState(group.groupId));
            await phoneSync.revokeDevice(browser.device.deviceKeyPair.publicKey);
            expect((await phoneSync.synchronize()).errors.size).toBe(0);
            expect((await browserSync.synchronize()).revoked).toBe(true);
            await expect(browserGroups.createExpense(group.groupId, browser.device.deviceKeyPair, expense)).rejects.toThrow('authorized active participant device');
        } finally {
            await relay.close();
            vi.unstubAllGlobals();
        }
    }, 20_000);
});
