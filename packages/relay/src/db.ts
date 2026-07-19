// =============================================================================
// SplitLedger Relay — Database Layer (SQLite)
// =============================================================================

import Database from 'better-sqlite3';

export interface StoredOperation {
    cursor: number;
    groupId: string;
    operationId: string;
    encryptedData: Buffer;
    receivedAt: string;
}

export interface NamespaceUsage {
    groupId: string;
    operationCount: number;
    storedBytes: number;
    firstReceivedAt: string | null;
    lastReceivedAt: string | null;
    disposable: boolean;
}

export class RelayDatabase {
    private db: Database.Database;
    private totalStoredBytes = 0;
    private readonly groupStoredBytes = new Map<string, number>();

    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.migrate();
        this.refreshStorageUsage();
    }

    // ─── Schema Migration ───

    private migrate(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        cursor          INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id        TEXT NOT NULL,
        operation_id    TEXT NOT NULL,
        encrypted_data  BLOB NOT NULL,
        received_at     TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(group_id, operation_id)
      );

      CREATE INDEX IF NOT EXISTS idx_operations_group_cursor
        ON operations(group_id, cursor);

      CREATE TABLE IF NOT EXISTS relay_groups (
        group_id        TEXT PRIMARY KEY,
        capability_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS disposable_namespaces (
        group_id TEXT PRIMARY KEY REFERENCES relay_groups(group_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS blocked_namespaces (
        group_id   TEXT PRIMARY KEY,
        blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

    `);
    }

    // ─── Operation Storage ───

    storeOperation(
        groupId: string,
        operationId: string,
        encryptedData: Buffer,
    ): boolean {
        const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO operations (group_id, operation_id, encrypted_data)
      VALUES (?, ?, ?)
    `);
        const result = stmt.run(groupId, operationId, encryptedData);
        if (result.changes > 0) {
            this.totalStoredBytes += encryptedData.length;
            this.groupStoredBytes.set(groupId, this.getGroupStoredBytes(groupId) + encryptedData.length);
        }
        return result.changes > 0;
    }

    hasOperation(groupId: string, operationId: string): boolean {
        return this.db.prepare(
            'SELECT 1 FROM operations WHERE group_id = ? AND operation_id = ?',
        ).get(groupId, operationId) !== undefined;
    }

    getOperationsAfter(groupId: string, cursor: number, limit: number): StoredOperation[] {
        const stmt = this.db.prepare(`
      SELECT cursor, group_id AS groupId, operation_id AS operationId,
             encrypted_data AS encryptedData, received_at AS receivedAt
      FROM operations
      WHERE group_id = ? AND cursor > ?
      ORDER BY cursor ASC LIMIT ?
    `);
        return stmt.all(groupId, cursor, limit) as StoredOperation[];
    }

    consumeGroup(groupId: string): StoredOperation[] {
        return this.db.transaction(() => {
            const operations = this.getOperationsAfter(groupId, 0, Number.MAX_SAFE_INTEGER);
            this.db.prepare('DELETE FROM operations WHERE group_id = ?').run(groupId);
            this.db.prepare('DELETE FROM relay_groups WHERE group_id = ?').run(groupId);
            const removedBytes = this.getGroupStoredBytes(groupId);
            this.totalStoredBytes -= removedBytes;
            this.groupStoredBytes.delete(groupId);
            return operations;
        })();
    }

    registerGroup(groupId: string, capabilityHash: string, disposable = false): boolean {
        this.db.prepare('INSERT OR IGNORE INTO relay_groups (group_id, capability_hash) VALUES (?, ?)')
            .run(groupId, capabilityHash);
        if (disposable && this.authorizeGroup(groupId, capabilityHash)) {
            this.db.prepare('INSERT OR IGNORE INTO disposable_namespaces (group_id) VALUES (?)').run(groupId);
        }
        return this.authorizeGroup(groupId, capabilityHash);
    }

    authorizeDisposableGroup(groupId: string, capabilityHash: string): boolean {
        return this.authorizeGroup(groupId, capabilityHash)
            && this.db.prepare('SELECT 1 FROM disposable_namespaces WHERE group_id = ?').get(groupId) !== undefined;
    }

    authorizeGroup(groupId: string, capabilityHash: string): boolean {
        const row = this.db.prepare('SELECT capability_hash AS capabilityHash FROM relay_groups WHERE group_id = ?')
            .get(groupId) as { capabilityHash: string } | undefined;
        return row?.capabilityHash === capabilityHash;
    }

    getOperationCount(groupId: string): number {
        const stmt = this.db.prepare('SELECT COUNT(*) AS count FROM operations WHERE group_id = ?');
        const row = stmt.get(groupId) as { count: number } | undefined;
        return row?.count ?? 0;
    }

    getGroupCount(): number {
        const stmt = this.db.prepare('SELECT COUNT(DISTINCT group_id) AS count FROM operations');
        const row = stmt.get() as { count: number } | undefined;
        return row?.count ?? 0;
    }

    getNamespaceCount(): number {
        const row = this.db.prepare('SELECT COUNT(*) AS count FROM relay_groups').get() as { count: number };
        return row.count;
    }

    hasGroup(groupId: string): boolean {
        return this.db.prepare('SELECT 1 FROM relay_groups WHERE group_id = ?').get(groupId) !== undefined;
    }

    isNamespaceBlocked(groupId: string): boolean {
        return this.db.prepare('SELECT 1 FROM blocked_namespaces WHERE group_id = ?').get(groupId) !== undefined;
    }

    getGroupStoredBytes(groupId: string): number {
        return this.groupStoredBytes.get(groupId) ?? 0;
    }

    getTotalStoredBytes(): number {
        return this.totalStoredBytes;
    }

    getTotalOperationCount(): number {
        const row = this.db.prepare('SELECT COUNT(*) AS count FROM operations').get() as { count: number };
        return row.count;
    }

    listNamespaceUsage(limit: number): NamespaceUsage[] {
        const rows = this.db.prepare(`
            SELECT groups.group_id AS groupId,
                   COUNT(operations.cursor) AS operationCount,
                   COALESCE(SUM(length(operations.encrypted_data)), 0) AS storedBytes,
                   MIN(operations.received_at) AS firstReceivedAt,
                   MAX(operations.received_at) AS lastReceivedAt,
                   CASE WHEN disposable.group_id IS NULL THEN 0 ELSE 1 END AS disposable
            FROM relay_groups AS groups
            LEFT JOIN operations ON operations.group_id = groups.group_id
            LEFT JOIN disposable_namespaces AS disposable ON disposable.group_id = groups.group_id
            GROUP BY groups.group_id, disposable.group_id
            ORDER BY storedBytes DESC, operationCount DESC, groups.group_id ASC
            LIMIT ?
        `).all(limit) as Array<Omit<NamespaceUsage, 'disposable'> & { disposable: number }>;
        return rows.map((row) => ({ ...row, disposable: row.disposable === 1 }));
    }

    deleteNamespace(groupId: string): boolean {
        return this.db.transaction(() => {
            if (!this.hasGroup(groupId)) return false;
            this.db.prepare('INSERT OR IGNORE INTO blocked_namespaces (group_id) VALUES (?)').run(groupId);
            this.db.prepare('DELETE FROM operations WHERE group_id = ?').run(groupId);
            this.db.prepare('DELETE FROM relay_groups WHERE group_id = ?').run(groupId);
            const removedBytes = this.getGroupStoredBytes(groupId);
            this.totalStoredBytes -= removedBytes;
            this.groupStoredBytes.delete(groupId);
            return true;
        })();
    }

    // ─── Maintenance ───

    pruneOldOperations(retentionDays: number): number {
        const stmt = this.db.prepare(
            `DELETE FROM operations WHERE received_at < datetime('now', '-' || ? || ' days')`,
        );
        const changes = stmt.run(retentionDays).changes;
        if (changes > 0) this.refreshStorageUsage();
        return changes;
    }

    private refreshStorageUsage(): void {
        const rows = this.db.prepare(`
            SELECT group_id AS groupId, COALESCE(SUM(length(encrypted_data)), 0) AS bytes
            FROM operations GROUP BY group_id
        `).all() as Array<{ groupId: string; bytes: number }>;
        this.groupStoredBytes.clear();
        this.totalStoredBytes = 0;
        for (const row of rows) {
            this.groupStoredBytes.set(row.groupId, row.bytes);
            this.totalStoredBytes += row.bytes;
        }
    }

    close(): void {
        this.db.close();
    }
}
