// =============================================================================
// SplitLedger Relay — Configuration
// =============================================================================

export interface RelayConfig {
    port: number;
    host: string;
    dbPath: string;
    adminToken?: string;

    // Rate limits
    maxOperationSizeBytes: number;
    maxOperationsPerGroup: number;
    maxGroupStorageBytes: number;
    maxTotalStorageBytes: number;
    maxNamespaces: number;
    maxWsMessageSizeBytes: number;
    maxNamespaceCreationsPerIpPerMinute: number;
    maxPublishesPerIpPerMinute: number;
    maxUploadBytesPerIpPerMinute: number;
    maxRateLimitSources: number;
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
    const adminToken = env['RELAY_ADMIN_TOKEN']?.trim() || undefined;
    if (adminToken && adminToken.length < 32) {
        throw new Error('RELAY_ADMIN_TOKEN must contain at least 32 characters');
    }
    return {
        port: integerSetting(env, 'PORT', 8443, 0),
        host: env['HOST'] ?? '0.0.0.0',
        dbPath: env['DB_PATH'] ?? './relay.db',
        adminToken,

        maxOperationSizeBytes: integerSetting(env, 'MAX_OPERATION_SIZE_BYTES', 65536, 1),
        maxOperationsPerGroup: integerSetting(env, 'MAX_OPERATIONS_PER_GROUP', 1000000, 1),
        maxGroupStorageBytes: integerSetting(env, 'MAX_GROUP_STORAGE_BYTES', 67108864, 1),
        maxTotalStorageBytes: integerSetting(env, 'MAX_TOTAL_STORAGE_BYTES', 1073741824, 1),
        maxNamespaces: integerSetting(env, 'MAX_NAMESPACES', 10000, 1),
        maxWsMessageSizeBytes: integerSetting(env, 'MAX_WS_MESSAGE_SIZE_BYTES', 131072, 1),
        maxNamespaceCreationsPerIpPerMinute: integerSetting(env, 'MAX_NAMESPACE_CREATIONS_PER_IP_PER_MINUTE', 30, 1),
        maxPublishesPerIpPerMinute: integerSetting(env, 'MAX_PUBLISHES_PER_IP_PER_MINUTE', 3000, 1),
        maxUploadBytesPerIpPerMinute: integerSetting(env, 'MAX_UPLOAD_BYTES_PER_IP_PER_MINUTE', 16777216, 1),
        maxRateLimitSources: integerSetting(env, 'MAX_RATE_LIMIT_SOURCES', 10000, 1),
        wsIdleTimeoutMs: integerSetting(env, 'WS_IDLE_TIMEOUT_MS', 300000, 1),
        maxConnectionsPerIp: integerSetting(env, 'MAX_CONNECTIONS_PER_IP', 50, 1),
        trustProxy: booleanSetting(env, 'TRUST_PROXY', false),
        pageSize: integerSetting(env, 'PAGE_SIZE', 500, 1),

        operationRetentionDays: integerSetting(env, 'OPERATION_RETENTION_DAYS', 0, 0),
    };
}
