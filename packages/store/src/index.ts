import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from './migrations';

// --- Interfaces ---

export interface StoredDevice {
  id: string;
  pairingHash: string;
  expiresAt: number;
  paired: boolean;
  createdAt: number;
  lastSeen: number;
}

export interface StoredUser {
  id: string;
  telegramUserId: string;
  username: string;
  role: 'user' | 'admin';
  createdAt: number;
}

export interface AuditLogEntry {
  id: number;
  timestamp: number;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  result: string;
}

export interface PendingRequest {
  id: string;
  type: string;
  threadId: string;
  turnId?: string;
  data: unknown;
  createdAt: number;
  expiresAt: number;
  resolved: boolean;
  resolvedAt?: number;
  resolution?: unknown;
}

export interface ThreadBinding {
  threadId: string;
  userId: string;
  createdAt: number;
}

export interface EventOffset {
  userId: string;
  threadId: string;
  lastEventId: number;
  updatedAt: number;
}

// --- LocalStore ---

export class LocalStore {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  async initialize(): Promise<void> {
    runMigrations(this.db);
  }

  // --- Device management ---

  async createDevice(deviceId: string, pairingHash: string, expiresAt: Date): Promise<void> {
    const now = Date.now();
    this.db.prepare(
      'INSERT OR REPLACE INTO devices (id, pairing_hash, expires_at, paired, created_at, last_seen) VALUES (?, ?, ?, 0, ?, ?)'
    ).run(deviceId, pairingHash, expiresAt.getTime(), now, now);
  }

  async getDeviceById(deviceId: string): Promise<StoredDevice | null> {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      pairingHash: row.pairing_hash as string,
      expiresAt: row.expires_at as number,
      paired: (row.paired as number) === 1,
      createdAt: row.created_at as number,
      lastSeen: row.last_seen as number,
    };
  }

  async getDeviceByPairingHash(pairingHash: string): Promise<StoredDevice | null> {
    const row = this.db.prepare(
      'SELECT * FROM devices WHERE pairing_hash = ? AND paired = 0 AND expires_at > ?'
    ).get(pairingHash, Date.now()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      pairingHash: row.pairing_hash as string,
      expiresAt: row.expires_at as number,
      paired: (row.paired as number) === 1,
      createdAt: row.created_at as number,
      lastSeen: row.last_seen as number,
    };
  }

  async pairDevice(deviceId: string): Promise<boolean> {
    const result = this.db.prepare('UPDATE devices SET paired = 1, last_seen = ? WHERE id = ?').run(Date.now(), deviceId);
    return result.changes > 0;
  }

  async updateDeviceLastSeen(deviceId: string): Promise<void> {
    this.db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), deviceId);
  }

  // --- User management ---

  async getUserByTelegramId(telegramUserId: string): Promise<StoredUser | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE telegram_user_id = ?').get(telegramUserId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      telegramUserId: row.telegram_user_id as string,
      username: row.username as string,
      role: row.role as 'user' | 'admin',
      createdAt: row.created_at as number,
    };
  }

  async createUser(telegramUserId: string, username: string): Promise<StoredUser> {
    const id = `usr_${Date.now()}`;
    const now = Date.now();
    this.db.prepare(
      'INSERT INTO users (id, telegram_user_id, username, role, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, telegramUserId, username, 'user', now);
    return { id, telegramUserId, username, role: 'user', createdAt: now };
  }

  // --- Audit log ---

  async addAuditLog(userId: string, action: string, targetType: string, targetId: string, result: string): Promise<void> {
    this.db.prepare(
      'INSERT INTO audit_log (timestamp, user_id, action, target_type, target_id, result) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(Date.now(), userId, action, targetType, targetId, result);
  }

  getAuditLog(limit = 100): AuditLogEntry[] {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map(row => ({
      id: row.id as number,
      timestamp: row.timestamp as number,
      userId: row.user_id as string,
      action: row.action as string,
      targetType: row.target_type as string,
      targetId: row.target_id as string,
      result: row.result as string,
    }));
  }

  // --- Pending requests (approval flow) ---

  async addPendingRequest(req: Omit<PendingRequest, 'createdAt' | 'resolved'>): Promise<void> {
    const dataStr = req.data !== undefined ? JSON.stringify(req.data) : null;
    this.db.prepare(
      'INSERT OR REPLACE INTO pending_requests (id, type, thread_id, turn_id, data, created_at, expires_at, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
    ).run(req.id, req.type, req.threadId, req.turnId ?? null, dataStr, Date.now(), req.expiresAt);
  }

  async getPendingRequest(id: string): Promise<PendingRequest | null> {
    const row = this.db.prepare('SELECT * FROM pending_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      type: row.type as string,
      threadId: row.thread_id as string,
      turnId: row.turn_id as string | undefined,
      data: row.data ? JSON.parse(row.data as string) : undefined,
      createdAt: row.created_at as number,
      expiresAt: row.expires_at as number,
      resolved: (row.resolved as number) === 1,
      resolvedAt: row.resolved_at as number | undefined,
      resolution: row.resolution ? JSON.parse(row.resolution as string) : undefined,
    };
  }

  async getPendingRequestsByThread(threadId: string): Promise<PendingRequest[]> {
    const rows = this.db.prepare('SELECT * FROM pending_requests WHERE thread_id = ? AND resolved = 0').all(threadId) as Record<string, unknown>[];
    return rows.map(row => ({
      id: row.id as string,
      type: row.type as string,
      threadId: row.thread_id as string,
      turnId: row.turn_id as string | undefined,
      data: row.data ? JSON.parse(row.data as string) : undefined,
      createdAt: row.created_at as number,
      expiresAt: row.expires_at as number,
      resolved: false,
    }));
  }

  async resolvePendingRequest(id: string, resolution: unknown): Promise<boolean> {
    const req = await this.getPendingRequest(id);
    if (!req || req.resolved) return false;
    this.db.prepare(
      'UPDATE pending_requests SET resolved = 1, resolved_at = ?, resolution = ? WHERE id = ? AND resolved = 0'
    ).run(Date.now(), JSON.stringify(resolution), id);
    return true;
  }

  // --- Thread bindings ---

  async bindThread(threadId: string, userId: string): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO thread_bindings (thread_id, user_id, created_at) VALUES (?, ?, ?)'
    ).run(threadId, userId, Date.now());
  }

  async getThreadBinding(threadId: string): Promise<ThreadBinding | null> {
    const row = this.db.prepare('SELECT * FROM thread_bindings WHERE thread_id = ?').get(threadId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      threadId: row.thread_id as string,
      userId: row.user_id as string,
      createdAt: row.created_at as number,
    };
  }

  // --- Event offsets ---

  async setEventOffset(userId: string, threadId: string, lastEventId: number): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO event_offsets (user_id, thread_id, last_event_id, updated_at) VALUES (?, ?, ?, ?)'
    ).run(userId, threadId, lastEventId, Date.now());
  }

  async getEventOffset(userId: string, threadId: string): Promise<EventOffset | null> {
    const row = this.db.prepare('SELECT * FROM event_offsets WHERE user_id = ? AND thread_id = ?').get(userId, threadId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      userId: row.user_id as string,
      threadId: row.thread_id as string,
      lastEventId: row.last_event_id as number,
      updatedAt: row.updated_at as number,
    };
  }

  // --- Cleanup ---

  close(): void {
    this.db.close();
  }
}
