const { createRootIdentity, createDeviceIdentity, createDeviceAuthorization, generateGroupId } = require('./dist/identity.js');
const { buildEntry, validateFullChain, orderEntries } = require('./dist/ledger.js');
const { EntryType } = require('./dist/types.js');
const { InMemoryStorageAdapter } = require('./dist/storage.js');
const { GroupManager } = require('./dist/group-manager.js');

async function run() {
    const storageA = new InMemoryStorageAdapter();
    const aliceRoot = createRootIdentity('Alice');
    const deviceA = createDeviceIdentity(aliceRoot.rootKeyPair, "Alice's Mac");

    await storageA.storeRootIdentity(aliceRoot);
    await storageA.storeDeviceIdentity(deviceA);
    const managerA = new GroupManager({ storage: storageA, deviceIdentity: deviceA, rootKeyPair: aliceRoot.rootKeyPair });

    // Device A creates group
    const { groupId } = await managerA.createGroup('Testing Auth', 'EUR');
    console.log('Group created by Device A');

    // Simulate Device B importing identity
    const storageB = new InMemoryStorageAdapter();
    const deviceB = createDeviceIdentity(aliceRoot.rootKeyPair, "Alice's iPhone");
    await storageB.storeRootIdentity(aliceRoot);
    await storageB.storeDeviceIdentity(deviceB);
    const managerB = new GroupManager({ storage: storageB, deviceIdentity: deviceB, rootKeyPair: aliceRoot.rootKeyPair });

    // Device B downloads group entries
    const entriesA = await storageA.getAllEntries(groupId);
    for (const entry of entriesA) {
        await storageB.appendEntry(groupId, entry);
    }

    // Device B validates chain
    const entriesB = await storageB.getAllEntries(groupId);
    const resultB = validateFullChain(entriesB);
    if (!resultB.valid) {
        console.error('Device B initial sync validation failed', resultB.errors);
        return;
    }
    console.log('Device B initial sync validation passed');

    // Device B calls auto-authorize
    const authEntry = await managerB.authorizeDevice(groupId, deviceB.deviceKeyPair.publicKey, deviceB.deviceName);
    console.log('Device B created DeviceAuthorized entry');

    // Device A receives the entry
    const entriesOnA = await storageA.getAllEntries(groupId);
    const combinedForA = [...entriesOnA, authEntry];
    const resultA = validateFullChain(combinedForA);

    if (!resultA.valid) {
        console.error('Device A validation of Device B auth entry FAILED!', resultA.errors);
    } else {
        console.log('Device A validation of Device B auth entry PASSED!');
    }
}

run().catch(console.error);
