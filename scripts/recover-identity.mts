import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import {
    createGroupAccessV2, createRelayForAccess, decryptFromRelay, deriveGroupKey,
    deriveGroupStateV2, groupAccessV2Schema, parseIdentityTransfer, rootIdentitySchema,
    signedOperationV2Schema, signIdentityDirectoryRecord,
    type Ed25519KeyPair, type GroupId, type Transport, type GroupAccessV2, type IdentityTransfer,
} from '../packages/core/src/index.ts';
import { decryptIdentity, encryptIdentity } from '../packages/web/src/utils/identity-export.ts';

export async function recover(json: string, relay: (access: GroupAccessV2) => Transport = createRelayForAccess) {
    const data = JSON.parse(json);
    if (data?.format !== 'fair-money-identity-transfer' || data.version !== 2
        || !Array.isArray(data.groupAccess) || data.groupAccess.length === 0) {
        throw new Error('UNSUPPORTED_TRANSFER');
    }
    const root = rootIdentitySchema.omit({ createdAt: true }).parse(data.identity);
    const accesses = (data.groupAccess as unknown[]).map((entry: unknown) => groupAccessV2Schema.safeParse(entry));
    const groups: IdentityTransfer['groups'] = [];
    const names: string[] = [];
    for (const [index, parsed] of accesses.entries()) {
        const report = (message: string) => console.log(`Group ${index + 1}: ${message}`);
        if (!parsed.success) {
            report('Unrecognized group access format.');
            continue;
        }
        const access = parsed.data;
        if (groups.some((group) => group.access.groupId === access.groupId)) {
            report('Duplicate group.');
            continue;
        }
        const endpoint = new URL(access.relayUrl);
        if (endpoint.username || endpoint.password || endpoint.hash) {
            report('Unsupported relay URL.');
            continue;
        }
        const transport = relay(access);
        const id = access.groupId as GroupId;
        let entries;
        try {
            await transport.connect(id);
            entries = await transport.getOperations(id);
        } catch {
            report('Could not retrieve history from the relay.');
            continue;
        } finally {
            await transport.disconnectAll();
        }
        if (!entries.length) {
            report('The relay returned no history. A device with the history needs to sync.');
            continue;
        }
        try {
            const key = deriveGroupKey(Buffer.from(access.groupSecret, 'base64url'), id);
            const operations = entries.map(({ encryptedOperation, operationId }) => {
                const plain = decryptFromRelay(Buffer.from(encryptedOperation, 'base64'), key);
                const op = signedOperationV2Schema.parse(JSON.parse(new TextDecoder().decode(plain)));
                if (op.operationId !== operationId || op.groupId !== id) throw new Error('binding');
                return op;
            });
            const state = deriveGroupStateV2(operations);
            if (!Object.values(state.participants).some((participant) =>
                participant.status === 'claimed' && participant.claimedRootPublicKey === root.rootKeyPair.publicKey)) {
                report('The identity does not own a claimed participant slot in this history.');
                continue;
            }
            groups.push({ access, operations });
            names.push(state.groupName);
            report(`${operations.length} verified operations found.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            report(message.startsWith('Missing protocol v2 parent:') || message.includes('exactly one GroupCreated root')
                ? 'Incomplete history. A device with the history needs to sync.'
                : 'Could not validate the retrieved operations.');
        }
    }
    if (!groups.length) return null;
    const directoryAccess = createGroupAccessV2(crypto.randomUUID(), groups[0].access.relayUrl);
    return parseIdentityTransfer({
        format: 'fair-money-identity-transfer', version: 3,
        identity: { ...root, directoryAccess }, groups,
        directoryRecords: groups.map(({ access }, index) => signIdentityDirectoryRecord(
            root.rootKeyPair as Ed25519KeyPair, directoryAccess.groupId,
            { type: 'GroupShared', access, groupName: names[index]! },
        )),
    });
}

async function readPassword(): Promise<string> {
    const silentOutput = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const prompt = createInterface({ input: process.stdin, output: silentOutput, terminal: true });
    const abort = new AbortController();
    prompt.once('SIGINT', () => abort.abort());
    process.stderr.write('Export password: ');
    try {
        return await prompt.question('', { signal: abort.signal });
    } finally {
        prompt.close();
        process.stderr.write('\n');
    }
}

async function main() {
    const source = process.argv[2];
    if (process.argv.length !== 3 || !source || !process.stdin.isTTY) {
        console.error('Run in a terminal: npm run recover:identity -- <export.json>');
        process.exitCode = 1;
        return;
    }
    if (typeof WebSocket !== 'function') {
        console.error('Run the recovery tool with Node.js 22 or newer.');
        process.exitCode = 1;
        return;
    }
    const contents = await readFile(source, 'utf8');
    const password = await readPassword();
    const json = await decryptIdentity(contents, password);
    const snapshot = await recover(json);
    if (!snapshot) {
        console.log('No importable history found.');
        process.exitCode = 2;
        return;
    }
    const encrypted = await encryptIdentity(JSON.stringify(snapshot), password);
    const folder = await mkdtemp(join(tmpdir(), 'fair-money-restored-'));
    const path = join(folder, 'fair-money-restored.json');
    await writeFile(path, encrypted, { flag: 'wx', mode: 0o600 });
    console.log(`${snapshot.groups.length} groups in the encrypted export.`);
    console.log(`Import file: ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        const code = error instanceof Error ? error.message : '';
        if (code === 'WRONG_PASSWORD') console.error('Decryption failed. Check the export password.');
        else if (code === 'UNSUPPORTED_TRANSFER') console.error('Expected an access-only transfer version 2 with group credentials.');
        else console.error('Recovery could not be completed.');
        process.exitCode = 1;
    });
}
