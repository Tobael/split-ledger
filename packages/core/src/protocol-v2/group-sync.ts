import { exchangeEncryptedSet } from '../sync/encrypted-set.js';
import type { Transport } from '../sync/transport.js';
import type { GroupServiceV2 } from './group-service.js';
import { signedOperationV2Schema } from './schemas.js';
import type { GroupAccessV2 } from './storage.js';

export async function synchronizeGroupV2(service: GroupServiceV2, access: GroupAccessV2, transport?: Transport) {
    let waitingForHistory = false;
    await exchangeEncryptedSet({
        access, transport,
        parse(value, id) {
            const record = signedOperationV2Schema.parse(value);
            if (record.operationId !== id) throw new Error('Relay operation ID mismatch');
            return record;
        },
        local: () => service.getOperations(access.groupId),
        id: (record) => record.operationId,
        async accept(records) {
            if (records.length === 0) {
                waitingForHistory = !(await service.getGroupState(access.groupId));
                return;
            }
            try {
                await service.acceptOperations(access.groupId, records);
                waitingForHistory = false;
            } catch (error) {
                if (error instanceof Error && (error.message.startsWith('Missing protocol v2 parent:')
                    || error.message === 'Protocol v2 operation set must contain exactly one GroupCreated root')) {
                    waitingForHistory = true;
                } else throw error;
            }
        },
    });
    return { state: await service.getGroupState(access.groupId), waitingForHistory };
}
