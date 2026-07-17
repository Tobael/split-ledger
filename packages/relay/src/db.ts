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

export class RelayDatabase {
    private db: Database.Database;

    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.migrate();
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

    // ─── Maintenance ───

    pruneOldOperations(retentionDays: number): number {
        const stmt = this.db.prepare(
            `DELETE FROM operations WHERE received_at < datetime('now', '-' || ? || ' days')`,
        );
        return stmt.run(retentionDays).changes;
    }

    close(): void {
        this.db.close();
    }
}
