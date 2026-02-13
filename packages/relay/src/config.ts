// =============================================================================
// SplitLedger Relay — Configuration
// =============================================================================

export interface RelayConfig {
    port: number;
    host: string;
    dbPath: string;

    // Rate limits
    maxEntriesPerGroupPerHour: number;
    maxEntrySizeBytes: number;
    maxGroupsPerRelay: number;
    maxEntriesPerGroup: number;
    wsIdleTimeoutMs: number;
    maxConnectionsPerIp: number;

    // Retention
    entryRetentionDays: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): RelayConfig {
    return {
        port: parseInt(env['PORT'] ?? '8443', 10),
        host: env['HOST'] ?? '0.0.0.0',
        dbPath: env['DB_PATH'] ?? './relay.db',

        maxEntriesPerGroupPerHour: parseInt(env['MAX_ENTRIES_PER_GROUP_PER_HOUR'] ?? '1000', 10),
        maxEntrySizeBytes: parseInt(env['MAX_ENTRY_SIZE_BYTES'] ?? '65536', 10),
        maxGroupsPerRelay: parseInt(env['MAX_GROUPS'] ?? '100000', 10),
        maxEntriesPerGroup: parseInt(env['MAX_ENTRIES_PER_GROUP'] ?? '1000000', 10),
        wsIdleTimeoutMs: parseInt(env['WS_IDLE_TIMEOUT_MS'] ?? '300000', 10),
        maxConnectionsPerIp: parseInt(env['MAX_CONNECTIONS_PER_IP'] ?? '50', 10),

        entryRetentionDays: parseInt(env['ENTRY_RETENTION_DAYS'] ?? '90', 10),
    };
}
