/**
 * Fault injection tests: transport failures, malformed messages,
 * concurrent requests, approval timeouts.
 */

import { CodexRpcClient, WebSocketTransport } from '@codex-mobile-bridge/codex-rpc';
import { MockAppServer } from '../fixtures/mock-app-server';
import { ApprovalEngine } from '@codex-mobile-bridge/mobile-core';
import { LocalStore } from '@codex-mobile-bridge/store';
import path from 'path';
import fs from 'fs';
import WebSocket, { WebSocketServer } from 'ws';

const FAULT_PORT = 14701;
const FAULT_DB = path.join(__dirname, 'test-fault.db');

function cleanupDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe('Fault injection: transport disconnect mid-request', () => {
  // Use a raw WebSocket server that delays responses
  let wss: WebSocketServer;
  const SLOW_PORT = FAULT_PORT;

  beforeAll((done) => {
    wss = new WebSocketServer({ port: SLOW_PORT });
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.method === 'initialize') {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } }));
            return;
          }
          if (msg.method === 'initialized') return; // notification, no response
          // Delay all other responses to allow disconnect
          if (msg.id !== undefined) {
            setTimeout(() => {
              try {
                ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { id: 'test' } }));
              } catch { /* socket may be closed */ }
            }, 2000);
          }
        } catch { /* ignore parse errors */ }
      });
    });
    wss.on('listening', done);
  });

  afterAll((done) => {
    wss.close(done);
  });

  it('should reject pending promises on transport close', async () => {
    const transport = new WebSocketTransport({ url: `ws://127.0.0.1:${SLOW_PORT}` });
    const client = new CodexRpcClient(transport, { defaultTimeout: 10000 });
    await client.connect();

    // Start a call that will be delayed by 2 seconds
    const callPromise = client.call('thread/read', { threadId: 'thread-001' });

    // Give the request time to be sent
    await new Promise(r => setTimeout(r, 100));

    // Force disconnect before response arrives
    await client.disconnect();

    // The promise should reject because the transport closed
    await expect(callPromise).rejects.toThrow();
  });

  it('should clear all pending requests on disconnect', async () => {
    const transport = new WebSocketTransport({ url: `ws://127.0.0.1:${SLOW_PORT}` });
    const client = new CodexRpcClient(transport, { defaultTimeout: 10000 });
    await client.connect();

    // Fire multiple calls that will be delayed
    const promises = [
      client.call('thread/read', { threadId: 'thread-001' }),
      client.call('thread/read', { threadId: 'thread-002' }),
      client.call('account/read'),
    ];

    await new Promise(r => setTimeout(r, 100));
    await client.disconnect();

    // All should reject
    for (const p of promises) {
      await expect(p).rejects.toThrow();
    }
  });
});

describe('Fault injection: malformed messages', () => {
  const MALFORMED_PORT = FAULT_PORT + 20;
  let wss: WebSocketServer;

  beforeAll((done) => {
    wss = new WebSocketServer({ port: MALFORMED_PORT });
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.jsonrpc !== '2.0') return; // ignore non-JSON-RPC
          if (msg.id !== undefined && msg.method) {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }));
          }
        } catch {
          // ignore malformed JSON
        }
      });
    });
    wss.on('listening', done);
  });

  afterAll((done) => {
    wss.close(done);
  });

  function connectAndReceive(port: number, onOpen: (ws: WebSocket) => void, matchId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out'));
      }, 5000);

      ws.on('open', () => onOpen(ws));
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === matchId && msg.result) {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        } catch { /* ignore */ }
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  it('should handle invalid JSON gracefully', async () => {
    await connectAndReceive(
      MALFORMED_PORT,
      (ws) => {
        ws.send('this is not json{{{');
        setTimeout(() => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
        }, 100);
      },
      1,
    );
  }, 10000);

  it('should handle missing jsonrpc field', async () => {
    await connectAndReceive(
      MALFORMED_PORT,
      (ws) => {
        ws.send(JSON.stringify({ id: 1, method: 'initialize', params: {} }));
        setTimeout(() => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }));
        }, 100);
      },
      2,
    );
  }, 10000);
});

describe('Fault injection: concurrent requests', () => {
  let mockServer: MockAppServer;

  beforeAll(async () => {
    mockServer = new MockAppServer({ port: FAULT_PORT + 10, eventDelay: 5 });
    await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  it('should handle 10 concurrent requests correctly', async () => {
    const transport = new WebSocketTransport({ url: `ws://127.0.0.1:${FAULT_PORT + 10}` });
    const client = new CodexRpcClient(transport, { defaultTimeout: 10000 });
    await client.connect();

    // Fire 10 concurrent requests to different threads
    const threadIds = ['thread-001', 'thread-002', 'thread-003'];
    const promises = Array.from({ length: 10 }, (_, i) =>
      client.call('thread/read', { threadId: threadIds[i % 3] })
    );

    const results = await Promise.all(promises);

    // All should resolve successfully
    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>).id).toBeDefined();
    }

    await client.disconnect();
  });
});

describe('Fault injection: approval timeout', () => {
  let store: LocalStore;

  beforeEach(() => {
    store = new LocalStore(FAULT_DB);
    return store.initialize();
  });

  afterEach(() => {
    store.close();
    cleanupDb(FAULT_DB);
  });

  it('should auto-reject approval after timeout', async () => {
    const engine = new ApprovalEngine(store, 200); // 200ms timeout
    engine.start();

    const result = await engine.submit({
      id: 'timeout-test-1',
      type: 'item/commandExecution/requestApproval',
      threadId: 'thread-001',
      data: { command: 'ls' },
    });

    // Should resolve as rejected with timeout reason
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('timeout');

    engine.stop();
  });

  it('should resolve multiple timed-out approvals', async () => {
    const engine = new ApprovalEngine(store, 150); // 150ms timeout
    engine.start();

    const promises = [
      engine.submit({ id: 'multi-1', type: 'cmd', threadId: 't1', data: {} }),
      engine.submit({ id: 'multi-2', type: 'cmd', threadId: 't2', data: {} }),
      engine.submit({ id: 'multi-3', type: 'cmd', threadId: 't3', data: {} }),
    ];

    const results = await Promise.all(promises);

    for (const result of results) {
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('timeout');
    }

    engine.stop();
  });
});
