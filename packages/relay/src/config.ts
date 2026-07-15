// =============================================================================
// SplitLedger Relay — Configuration
// =============================================================================

export interface RelayConfig {
    port: number;
    host: string;
    dbPath: string;

    // Rate limits
    maxOperationSizeBytes: number;
    maxOperationsPerGroup: number;
    wsIdleTimeoutMs: number;
    maxConnectionsPerIp: number;
    trustProxy: boolean;
    pageSize: number;

    // Retention
    operationRetentionDays: number;
}

function integerSetting(
    env: Record<string, string | undefined>,
    name: string,
    fallback: number,
    minimum: number,
): number {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}`);
    }
    return value;
}

function booleanSetting(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
    const value = env[name];
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} must be true or false`);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): RelayConfig {
    return {
        port: integerSetting(env, 'PORT', 8443, 0),
        host: env['HOST'] ?? '0.0.0.0',
        dbPath: env['DB_PATH'] ?? './relay.db',

        maxOperationSizeBytes: integerSetting(env, 'MAX_OPERATION_SIZE_BYTES', 65536, 1),
        maxOperationsPerGroup: integerSetting(env, 'MAX_OPERATIONS_PER_GROUP', 1000000, 1),
        wsIdleTimeoutMs: integerSetting(env, 'WS_IDLE_TIMEOUT_MS', 300000, 1),
        maxConnectionsPerIp: integerSetting(env, 'MAX_CONNECTIONS_PER_IP', 50, 1),
        trustProxy: booleanSetting(env, 'TRUST_PROXY', false),
        pageSize: integerSetting(env, 'PAGE_SIZE', 500, 1),

        operationRetentionDays: integerSetting(env, 'OPERATION_RETENTION_DAYS', 0, 0),
    };
}
