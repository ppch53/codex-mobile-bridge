import { WebSocketServer } from './WebSocketServer';
import { EventRouter, ApprovalEngine } from '@codex-mobile-bridge/mobile-core';
import { AuthGuard } from '@codex-mobile-bridge/security';
import { LocalStore } from '@codex-mobile-bridge/store';
import type { CodexAdapter } from '@codex-mobile-bridge/codex-adapter';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';

function createMockAdapter(): CodexAdapter {
  return {
    readAccount: jest.fn().mockResolvedValue({ id: 'acct-1' }),
    listThreads: jest.fn().mockResolvedValue({ items: [{ id: 't-1', title: 'Test', status: 'active' }] }),
    readThread: jest.fn().mockResolvedValue({ id: 't-1', title: 'Test', status: 'active' }),
    startThread: jest.fn().mockResolvedValue({ id: 't-new', title: 'New', status: 'active' }),
    resumeThread: jest.fn().mockResolvedValue({ id: 't-1' }),
    startTurn: jest.fn().mockResolvedValue({ id: 'turn-1', threadId: 't-1', status: 'started' }),
    steerTurn: jest.fn().mockResolvedValue(undefined),
    interruptTurn: jest.fn().mockResolvedValue(undefined),
  } as unknown as CodexAdapter;
}

describe('WebSocketServer', () => {
  const testDbPath = path.join(__dirname, 'test-ws-store.db');
  let store: LocalStore;
  let wsServer: WebSocketServer;
  let adapter: CodexAdapter;
  let eventRouter: EventRouter;
  let approvalEngine: ApprovalEngine;
  let authGuard: AuthGuard;
  const PORT = 18765; // Use a non-standard port for tests

  beforeEach(async () => {
    store = new LocalStore(testDbPath);
    await store.initialize();
    adapter = createMockAdapter();
    eventRouter = new EventRouter();
    approvalEngine = new ApprovalEngine(store, 300_000);
    authGuard = new AuthGuard(store, ['*']); // Allow all for testing

    // Create and pair a test device so connections succeed
    await store.createDevice('test-device', 'hash', new Date(Date.now() + 60000));
    await store.pairDevice('test-device');

    wsServer = new WebSocketServer(
      PORT, eventRouter, authGuard, store, adapter, approvalEngine
    );
    wsServer.start();
  });

  afterEach(async () => {
    wsServer.stop();
    store.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
  });

  function connectClient(token = 'test-device'): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}?token=${token}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function sendAndReceive(ws: WebSocket, msg: object): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
      ws.once('message', (data) => {
        clearTimeout(timeout);
        resolve(JSON.parse(data.toString()));
      });
      ws.send(JSON.stringify(msg));
    });
  }

  it('should reject connection without token', (done) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.on('close', (code) => {
      expect(code).toBe(1008);
      done();
    });
    ws.on('open', () => {
      // Should close shortly after open
    });
  });

  it('should accept connection with valid token', async () => {
    const ws = await connectClient();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('should handle ping', async () => {
    const ws = await connectClient();
    const response = await sendAndReceive(ws, { type: 'ping' });
    expect(response.type).toBe('pong');
    ws.close();
  });

  it('should handle list request', async () => {
    const ws = await connectClient();
    const response = await sendAndReceive(ws, { type: 'list', requestId: 'r1' });
    expect(response.type).toBe('response');
    expect(response.requestId).toBe('r1');
    expect(adapter.listThreads).toHaveBeenCalled();
    ws.close();
  });

  it('should handle open request', async () => {
    const ws = await connectClient();
    const response = await sendAndReceive(ws, { type: 'open', requestId: 'r2', threadId: 't-1' });
    expect(response.type).toBe('response');
    expect(response.data).toEqual({ subscribed: 't-1' });
    ws.close();
  });

  it('should handle send request', async () => {
    const ws = await connectClient();
    const response = await sendAndReceive(ws, {
      type: 'send', requestId: 'r3', threadId: 't-1', text: 'hello',
    });
    expect(response.type).toBe('response');
    expect(adapter.startTurn).toHaveBeenCalledWith('t-1', 'hello');
    ws.close();
  });

  it('should handle interrupt request', async () => {
    const ws = await connectClient();
    // First send to set activeTurnId
    await sendAndReceive(ws, { type: 'send', requestId: 'r4', threadId: 't-1', text: 'hello' });
    const response = await sendAndReceive(ws, {
      type: 'interrupt', requestId: 'r5', threadId: 't-1',
    });
    expect(response.type).toBe('response');
    expect(adapter.interruptTurn).toHaveBeenCalledWith('t-1', expect.any(String));
    ws.close();
  });

  it('should return error for unknown message type', async () => {
    const ws = await connectClient();
    const response = await sendAndReceive(ws, { type: 'unknown', requestId: 'r6' });
    expect(response.type).toBe('response');
    expect(response.error).toBeDefined();
    ws.close();
  });

  it('should broadcast events to subscribed clients', (done) => {
    connectClient().then(ws => {
      // Subscribe to thread
      sendAndReceive(ws, { type: 'open', requestId: 'r1', threadId: 't-1' }).then(() => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'event') {
            expect(msg.event.type).toBe('turn/started');
            expect(msg.event.threadId).toBe('t-1');
            ws.close();
            done();
          }
        });

        // Emit an event on the thread
        eventRouter.emit({ type: 'turn/started', threadId: 't-1', turnId: 'turn-1' });
      });
    });
  });
});
