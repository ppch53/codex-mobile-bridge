import type BetterSqlite3 from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

type Migration = (db: BetterSqlite3.Database) => void;

const migrations: Migration[] = [
  // Migration 001: Initial schema
  (db: BetterSqlite3.Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        pairing_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        paired INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        telegram_user_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        result TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_requests (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        data TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at INTEGER,
        resolution TEXT
      );

      CREATE TABLE IF NOT EXISTS thread_bindings (
        thread_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_offsets (
        user_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        last_event_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, thread_id)
      );
    `);
  },
];

export function runMigrations(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null } | undefined;
  const currentVersion = row?.version ?? 0;

  for (let i = currentVersion; i < migrations.length; i++) {
    migrations[i](db);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(i + 1, Date.now());
  }
}
