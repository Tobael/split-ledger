import { canonicalize, hash, sign, verify } from '../crypto.js';
import type { PublicKey, SecretKey, Signature } from '../types.js';
import {
    signedOperationV2Schema,
    unsignedOperationV2Schema,
    type SignedOperationV2,
    type UnsignedOperationV2,
} from './schemas.js';

const signingPrefix = 'fair-money:v2:operation:';

export function computeOperationIdV2(operation: UnsignedOperationV2): string {
    return hash(canonicalize(unsignedOperationV2Schema.parse(operation)));
}

export function operationSigningMessageV2(operationId: string): Uint8Array {
    return new TextEncoder().encode(`${signingPrefix}${operationId}`);
}

export function signOperationV2(
    operation: UnsignedOperationV2,
    secretKey: SecretKey,
): SignedOperationV2 {
    const parsed = unsignedOperationV2Schema.parse(operation);
    const operationId = computeOperationIdV2(parsed);
    return signedOperationV2Schema.parse({
        ...parsed,
        operationId,
        signature: sign(operationSigningMessageV2(operationId), secretKey),
    });
}

export function verifyOperationV2(value: unknown): SignedOperationV2 {
    const signed = signedOperationV2Schema.parse(value);
    const { operationId, signature, ...unsignedValue } = signed;
    const unsigned = unsignedOperationV2Schema.parse(unsignedValue);
    const computedId = computeOperationIdV2(unsigned);
    if (computedId !== operationId) {
        throw new Error('Protocol v2 operation ID does not match canonical content');
    }
    if (!verify(
        operationSigningMessageV2(operationId),
        signature as Signature,
        signed.actorPublicKey as PublicKey,
    )) {
        throw new Error('Protocol v2 operation signature is invalid');
    }
    return signed;
}
