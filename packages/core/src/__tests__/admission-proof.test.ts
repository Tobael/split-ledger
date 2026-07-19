import { describe, expect, it } from 'vitest';
import { solveRelayAdmissionProof, verifyRelayAdmissionProof } from '../sync/admission-proof.js';

describe('relay namespace admission proof', () => {
    it('solves a proof bound to the group and capability', async () => {
        const groupId = '00000000-0000-4000-8000-000000000001';
        const capability = 'A'.repeat(43);
        const nonce = await solveRelayAdmissionProof(groupId, capability, 8);
        expect(verifyRelayAdmissionProof(groupId, capability, nonce, 8)).toBe(true);
        expect(verifyRelayAdmissionProof(groupId.replace(/1$/, '2'), capability, nonce, 8)).toBe(false);
    });

    it('rejects malformed or unreasonable proofs', async () => {
        expect(verifyRelayAdmissionProof('group', 'capability', 'not-hex', 8)).toBe(false);
        await expect(solveRelayAdmissionProof('group', 'capability', 33)).rejects.toThrow(/difficulty/);
    });
});
