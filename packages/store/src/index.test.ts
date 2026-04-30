import { LocalStore } from './index';
import fs from 'fs';
import path from 'path';

describe('LocalStore', () => {
  const testDbPath = path.join(__dirname, 'test-store.db');
  let store: LocalStore;

  beforeEach(async () => {
    store = new LocalStore(testDbPath);
    await store.initialize();
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    // Clean up WAL/SHM files
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
  });

  // --- Basic ---

  it('should initialize and create data file', () => {
    expect(fs.existsSync(testDbPath)).toBe(true);
  });

  it('should load existing data on reinitialize', async () => {
    const deviceId = 'dev-1';
    await store.createDevice(deviceId, 'hash123', new Date(Date.now() + 60000));

    store.close();
    const store2 = new LocalStore(testDbPath);
    await store2.initialize();
    const device = await store2.getDeviceById(deviceId);
    expect(device).not.toBeNull();
    expect(device!.id).toBe(deviceId);
    store2.close();
  });

  // --- Device management ---

  describe('devices', () => {
    it('should create and retrieve a device', async () => {
      const expiresAt = new Date(Date.now() + 60000);
      await store.createDevice('dev-1', 'hash-abc', expiresAt);

      const device = await store.getDeviceById('dev-1');
      expect(device).not.toBeNull();
      expect(device!.id).toBe('dev-1');
      expect(device!.pairingHash).toBe('hash-abc');
      expect(device!.paired).toBe(false);
    });

    it('should return null for unknown device', async () => {
      expect(await store.getDeviceById('unknown')).toBeNull();
    });

    it('should pair a device', async () => {
      await store.createDevice('dev-1', 'hash', new Date(Date.now() + 60000));
      const result = await store.pairDevice('dev-1');
      expect(result).toBe(true);

      const device = await store.getDeviceById('dev-1');
      expect(device!.paired).toBe(true);
    });

    it('should return false when pairing unknown device', async () => {
      expect(await store.pairDevice('unknown')).toBe(false);
    });

    it('should update device lastSeen', async () => {
      await store.createDevice('dev-1', 'hash', new Date(Date.now() + 60000));
      const before = (await store.getDeviceById('dev-1'))!.lastSeen;

      await new Promise(r => setTimeout(r, 10));
      await store.updateDeviceLastSeen('dev-1');

      const after = (await store.getDeviceById('dev-1'))!.lastSeen;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  // --- User management ---

  describe('users', () => {
    it('should create and retrieve a user', async () => {
      const user = await store.createUser('tg-123', 'alice');
      expect(user.telegramUserId).toBe('tg-123');
      expect(user.username).toBe('alice');
      expect(user.role).toBe('user');

      const found = await store.getUserByTelegramId('tg-123');
      expect(found).not.toBeNull();
      expect(found!.username).toBe('alice');
    });

    it('should return null for unknown telegram user', async () => {
      expect(await store.getUserByTelegramId('unknown')).toBeNull();
    });
  });

  // --- Audit log ---

  describe('audit log', () => {
    it('should append and retrieve audit entries', async () => {
      await store.addAuditLog('user-1', 'pairing.verify', 'device', 'dev-1', 'success');
      await store.addAuditLog('user-1', 'turn.start', 'thread', 't-1', 'success');

      const log = store.getAuditLog();
      expect(log).toHaveLength(2);
      // ORDER BY id DESC returns most recent first
      expect(log[0].action).toBe('turn.start');
      expect(log[1].action).toBe('pairing.verify');
    });

    it('should not contain sensitive data', async () => {
      await store.addAuditLog('u1', 'pairing.verify', 'device', 'dev-1', 'success');

      const log = store.getAuditLog();
      const serialized = JSON.stringify(log);
      // Audit log stores summaries, not tokens/keys
      expect(serialized).not.toMatch(/token/i);
      expect(serialized).not.toMatch(/password/i);
      expect(serialized).not.toMatch(/Authorization/i);
      expect(serialized).not.toMatch(/api_key/i);
    });
  });

  // --- Pending requests ---

  describe('pending requests', () => {
    it('should add, get, and resolve a pending request', async () => {
      await store.addPendingRequest({
        id: 'req-1',
        type: 'commandApproval',
        threadId: 't-1',
        data: { command: 'ls' },
        expiresAt: Date.now() + 300000,
      });

      const req = await store.getPendingRequest('req-1');
      expect(req).not.toBeNull();
      expect(req!.resolved).toBe(false);

      const resolved = await store.resolvePendingRequest('req-1', { approved: true });
      expect(resolved).toBe(true);

      const after = await store.getPendingRequest('req-1');
      expect(after!.resolved).toBe(true);
      expect(after!.resolution).toEqual({ approved: true });
    });

    it('should not double-resolve', async () => {
      await store.addPendingRequest({
        id: 'req-1',
        type: 'test',
        threadId: 't-1',
        data: {},
        expiresAt: Date.now() + 300000,
      });

      expect(await store.resolvePendingRequest('req-1', true)).toBe(true);
      expect(await store.resolvePendingRequest('req-1', false)).toBe(false);
    });

    it('should get pending requests by thread', async () => {
      await store.addPendingRequest({
        id: 'req-1',
        type: 'commandApproval',
        threadId: 't-1',
        data: {},
        expiresAt: Date.now() + 300000,
      });
      await store.addPendingRequest({
        id: 'req-2',
        type: 'commandApproval',
        threadId: 't-1',
        data: {},
        expiresAt: Date.now() + 300000,
      });
      await store.addPendingRequest({
        id: 'req-3',
        type: 'commandApproval',
        threadId: 't-2',
        data: {},
        expiresAt: Date.now() + 300000,
      });

      const t1Requests = await store.getPendingRequestsByThread('t-1');
      expect(t1Requests).toHaveLength(2);

      const t2Requests = await store.getPendingRequestsByThread('t-2');
      expect(t2Requests).toHaveLength(1);
    });
  });

  // --- Thread bindings ---

  describe('thread bindings', () => {
    it('should bind and retrieve thread to user', async () => {
      await store.bindThread('t-1', 'user-1');
      const binding = await store.getThreadBinding('t-1');
      expect(binding).not.toBeNull();
      expect(binding!.userId).toBe('user-1');
    });
  });

  // --- Event offsets ---

  describe('event offsets', () => {
    it('should set and get event offset', async () => {
      await store.setEventOffset('user-1', 't-1', 42);
      const offset = await store.getEventOffset('user-1', 't-1');
      expect(offset).not.toBeNull();
      expect(offset!.lastEventId).toBe(42);
    });

    it('should return null for unknown offset', async () => {
      expect(await store.getEventOffset('user-1', 't-unknown')).toBeNull();
    });
  });
});
