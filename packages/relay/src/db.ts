// =============================================================================
// SplitLedger Relay — Database Layer (SQLite)
// =============================================================================

import Database from 'better-sqlite3';
import type { RelayConfig } from './config.js';

export interface StoredEntry {
    id: number;
    groupId: string;
    lamportClock: number;
    encryptedData: Buffer;
    receivedAt: string;
    senderPubkey: string;
}

export interface StoredInvite {
    inviteId: string;
    groupId: string;
    inviteData: Buffer;
    creatorPubkey: string;
    expiresAt: string;
    createdAt: string;
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
      CREATE TABLE IF NOT EXISTS encrypted_entries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id        TEXT NOT NULL,
        lamport_clock   INTEGER NOT NULL,
        encrypted_data  BLOB NOT NULL,
        received_at     TEXT NOT NULL DEFAULT (datetime('now')),
        sender_pubkey   TEXT NOT NULL,
        UNIQUE(group_id, lamport_clock, sender_pubkey)
      );

      CREATE INDEX IF NOT EXISTS idx_entries_group_lamport
        ON encrypted_entries(group_id, lamport_clock);

      CREATE TABLE IF NOT EXISTS invites (
        invite_id       TEXT PRIMARY KEY,
        group_id        TEXT NOT NULL,
        invite_data     BLOB NOT NULL,
        creator_pubkey  TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_invites_expiry ON invites(expires_at);
    `);
    }

    // ─── Entry Operations ───

    storeEntry(
        groupId: string,
        lamportClock: number,
        encryptedData: Buffer,
        senderPubkey: string,
    ): boolean {
        const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO encrypted_entries (group_id, lamport_clock, encrypted_data, sender_pubkey)
      VALUES (?, ?, ?, ?)
    `);
        const result = stmt.run(groupId, lamportClock, encryptedData, senderPubkey);
        return result.changes > 0;
    }

    getEntriesAfter(groupId: string, afterLamportClock: number): StoredEntry[] {
        const stmt = this.db.prepare(`
      SELECT id, group_id AS groupId, lamport_clock AS lamportClock,
             encrypted_data AS encryptedData, received_at AS receivedAt,
             sender_pubkey AS senderPubkey
      FROM encrypted_entries
      WHERE group_id = ? AND lamport_clock > ?
      ORDER BY lamport_clock ASC
    `);
        return stmt.all(groupId, afterLamportClock) as StoredEntry[];
    }

    getFullLedger(groupId: string): StoredEntry[] {
        const stmt = this.db.prepare(`
      SELECT id, group_id AS groupId, lamport_clock AS lamportClock,
             encrypted_data AS encryptedData, received_at AS receivedAt,
             sender_pubkey AS senderPubkey
      FROM encrypted_entries
      WHERE group_id = ?
      ORDER BY lamport_clock ASC
    `);
        return stmt.all(groupId) as StoredEntry[];
    }

    getEntryCount(groupId: string): number {
        const stmt = this.db.prepare('SELECT COUNT(*) AS count FROM encrypted_entries WHERE group_id = ?');
        const row = stmt.get(groupId) as { count: number } | undefined;
        return row?.count ?? 0;
    }

    getGroupCount(): number {
        const stmt = this.db.prepare('SELECT COUNT(DISTINCT group_id) AS count FROM encrypted_entries');
        const row = stmt.get() as { count: number } | undefined;
        return row?.count ?? 0;
    }

    // ─── Invite Operations ───

    storeInvite(inviteId: string, groupId: string, inviteData: Buffer, creatorPubkey: string, expiresAt: Date): void {
        const stmt = this.db.prepare(`
      INSERT INTO invites (invite_id, group_id, invite_data, creator_pubkey, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);
        stmt.run(inviteId, groupId, inviteData, creatorPubkey, expiresAt.toISOString());
    }

    getInvite(inviteId: string): StoredInvite | null {
        const stmt = this.db.prepare(`
      SELECT invite_id AS inviteId, group_id AS groupId, invite_data AS inviteData,
             creator_pubkey AS creatorPubkey, expires_at AS expiresAt, created_at AS createdAt
      FROM invites WHERE invite_id = ?
    `);
        return (stmt.get(inviteId) as StoredInvite | undefined) ?? null;
    }

    deleteInvite(inviteId: string, creatorPubkey: string): boolean {
        const stmt = this.db.prepare('DELETE FROM invites WHERE invite_id = ? AND creator_pubkey = ?');
        return stmt.run(inviteId, creatorPubkey).changes > 0;
    }

    // ─── Maintenance ───

    pruneExpiredInvites(): number {
        const stmt = this.db.prepare("DELETE FROM invites WHERE expires_at < datetime('now')");
        return stmt.run().changes;
    }

    pruneOldEntries(retentionDays: number): number {
        const stmt = this.db.prepare(
            `DELETE FROM encrypted_entries WHERE received_at < datetime('now', '-' || ? || ' days')`,
        );
        return stmt.run(retentionDays).changes;
    }

    close(): void {
        this.db.close();
    }
}
