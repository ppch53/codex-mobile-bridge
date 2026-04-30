import request from 'supertest';
import { createHttpServer } from './server';
import { LocalStore } from '@codex-mobile-bridge/store';
import { AuthGuard } from '@codex-mobile-bridge/security';
import path from 'path';
import fs from 'fs';

describe('HTTP Server', () => {
  const testDbPath = path.join(__dirname, 'test-http-store.db');
  let store: LocalStore;
  let authGuard: AuthGuard;
  let app: ReturnType<typeof createHttpServer>;

  beforeEach(async () => {
    store = new LocalStore(testDbPath);
    await store.initialize();
    authGuard = new AuthGuard(store, ['12345']);
    app = createHttpServer(authGuard, store);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
  });

  describe('GET /api/status', () => {
    it('should return ok status', async () => {
      const res = await request(app).get('/api/status');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('POST /api/pairing/generate', () => {
    it('should return a pairing code', async () => {
      const res = await request(app).post('/api/pairing/generate');
      expect(res.status).toBe(200);
      expect(res.body.deviceId).toBeDefined();
      expect(res.body.code).toBeDefined();
      expect(res.body.code).toMatch(/^\d{6}$/);
      expect(res.body.expiresIn).toBe(600);
    });
  });

  describe('POST /api/pairing/verify', () => {
    it('should return 400 when missing code', async () => {
      const res = await request(app)
        .post('/api/pairing/verify')
        .send({});
      expect(res.status).toBe(400);
    });

    it('should verify with code only (no deviceId)', async () => {
      const genRes = await request(app).post('/api/pairing/generate');
      const { code, deviceId } = genRes.body;

      const res = await request(app)
        .post('/api/pairing/verify')
        .send({ code });
      expect(res.status).toBe(200);
      expect(res.body.token).toBe(deviceId);
    });

    it('should return 401 for invalid code', async () => {
      // Generate a valid pairing first
      const genRes = await request(app).post('/api/pairing/generate');
      const { deviceId } = genRes.body;

      const res = await request(app)
        .post('/api/pairing/verify')
        .send({ deviceId, code: '000000' });
      expect(res.status).toBe(401);
    });

    it('should verify a valid pairing code', async () => {
      const genRes = await request(app).post('/api/pairing/generate');
      const { deviceId, code } = genRes.body;

      const res = await request(app)
        .post('/api/pairing/verify')
        .send({ deviceId, code });
      expect(res.status).toBe(200);
      expect(res.body.token).toBe(deviceId);
    });
  });
});
