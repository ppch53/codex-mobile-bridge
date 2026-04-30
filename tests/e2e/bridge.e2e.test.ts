/**
 * E2E test: Full bridge startup with MockAppServer
 *
 * Tests: HTTP status endpoint, pairing flow, WebSocket connection through bridge
 */

import { MockAppServer } from '../fixtures/mock-app-server';
import http from 'http';
import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';

const MOCK_CODEX_PORT = 14601;
const BRIDGE_HTTP_PORT = 14602;
const E2E_DB = path.join(__dirname, 'test-e2e.db');

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    }).on('error', reject);
  });
}

function httpPost(port: number, path: string, data: Record<string, unknown>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('E2E: Bridge HTTP endpoints', () => {
  let mockServer: MockAppServer;

  beforeAll(async () => {
    mockServer = new MockAppServer({ port: MOCK_CODEX_PORT, eventDelay: 10 });
    await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  it('should respond to GET /api/status', async () => {
    // Use the bridge HTTP server directly
    const { LocalStore } = await import('@codex-mobile-bridge/store');
    const { AuthGuard } = await import('@codex-mobile-bridge/security');
    const { createHttpServer } = await import('../../apps/bridge/src/http/server');

    const store = new LocalStore(E2E_DB);
    await store.initialize();
    const authGuard = new AuthGuard(store, []);

    const app = createHttpServer(authGuard, store);
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(BRIDGE_HTTP_PORT, '127.0.0.1', resolve));

    try {
      const res = await httpGet(BRIDGE_HTTP_PORT, '/api/status');
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      if (fs.existsSync(E2E_DB)) fs.unlinkSync(E2E_DB);
      if (fs.existsSync(E2E_DB + '-wal')) fs.unlinkSync(E2E_DB + '-wal');
      if (fs.existsSync(E2E_DB + '-shm')) fs.unlinkSync(E2E_DB + '-shm');
    }
  });

  it('should handle pairing generate and verify flow', async () => {
    const { LocalStore } = await import('@codex-mobile-bridge/store');
    const { AuthGuard } = await import('@codex-mobile-bridge/security');
    const { createHttpServer } = await import('../../apps/bridge/src/http/server');

    const store = new LocalStore(E2E_DB + '.pair');
    await store.initialize();
    const authGuard = new AuthGuard(store, []);

    const app = createHttpServer(authGuard, store);
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(BRIDGE_HTTP_PORT + 1, '127.0.0.1', resolve));

    try {
      // Generate pairing code
      const genRes = await httpPost(BRIDGE_HTTP_PORT + 1, '/api/pairing/generate', {});
      expect(genRes.status).toBe(200);
      const { code, deviceId } = JSON.parse(genRes.body);
      expect(code).toBeDefined();
      expect(deviceId).toBeDefined();

      // Verify pairing code
      const verifyRes = await httpPost(BRIDGE_HTTP_PORT + 1, '/api/pairing/verify', { code, deviceId });
      expect(verifyRes.status).toBe(200);
      const verifyBody = JSON.parse(verifyRes.body);
      expect(verifyBody.token).toBeDefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      const dbPath = E2E_DB + '.pair';
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
      if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
    }
  });

  it('should handle code-only pairing verify flow', async () => {
    const { LocalStore } = await import('@codex-mobile-bridge/store');
    const { AuthGuard } = await import('@codex-mobile-bridge/security');
    const { createHttpServer } = await import('../../apps/bridge/src/http/server');

    const store = new LocalStore(E2E_DB + '.codeonly');
    await store.initialize();
    const authGuard = new AuthGuard(store, []);

    const app = createHttpServer(authGuard, store);
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(BRIDGE_HTTP_PORT + 2, '127.0.0.1', resolve));

    try {
      // Generate pairing code
      const genRes = await httpPost(BRIDGE_HTTP_PORT + 2, '/api/pairing/generate', {});
      expect(genRes.status).toBe(200);
      const { code, deviceId } = JSON.parse(genRes.body);

      // Verify with code only (no deviceId)
      const verifyRes = await httpPost(BRIDGE_HTTP_PORT + 2, '/api/pairing/verify', { code });
      expect(verifyRes.status).toBe(200);
      const verifyBody = JSON.parse(verifyRes.body);
      expect(verifyBody.token).toBe(deviceId);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      const dbPath = E2E_DB + '.codeonly';
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
      if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
    }
  });
});

describe('E2E: MockAppServer direct connectivity', () => {
  let mockServer: MockAppServer;

  beforeAll(async () => {
    mockServer = new MockAppServer({ port: MOCK_CODEX_PORT + 10, eventDelay: 10 });
    await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  it('should connect and receive turn events end-to-end', (done) => {
    const ws = new WebSocket(`ws://127.0.0.1:${MOCK_CODEX_PORT + 10}`);
    const events: string[] = [];
    const timerHolder: { id: ReturnType<typeof setTimeout> | null } = { id: null };

    ws.on('open', () => {
      // Initialize handshake
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.id === 1) {
        // Send initialized notification
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));
        // Start a turn
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'turn/start',
          params: { threadId: 'thread-001', input: 'E2E test message' },
        }));
        return;
      }

      if (msg.id === 2) {
        // turn/start response received, events will follow
        return;
      }

      if (msg.method) {
        events.push(msg.method);
        if (msg.method === 'turn/completed') {
          expect(events).toContain('turn/started');
          expect(events).toContain('item/started');
          expect(events).toContain('item/agentMessage/delta');
          expect(events).toContain('item/completed');
          expect(events).toContain('turn/completed');
          if (timerHolder.id) clearTimeout(timerHolder.id);
          ws.close();
          done();
        }
      }
    });

    ws.on('error', done);

    timerHolder.id = setTimeout(() => {
      ws.close();
      done(new Error('E2E turn event test timed out'));
    }, 10000);
  });
});
