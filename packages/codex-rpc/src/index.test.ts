import { CodexRpcClient, Transport, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from './index';

// --- MockTransport ---

class MockTransport implements Transport {
  private messageListeners: ((data: string) => void)[] = [];
  private closeListeners: (() => void)[] = [];
  public sent: string[] = [];

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async send(message: string): Promise<void> {
    this.sent.push(message);
  }

  onMessage(cb: (data: string) => void): void {
    this.messageListeners.push(cb);
  }

  onClose(cb: () => void): void {
    this.closeListeners.push(cb);
  }

  // Test helpers
  receive(data: unknown): void {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    for (const cb of this.messageListeners) cb(str);
  }

  simulateClose(): void {
    for (const cb of this.closeListeners) cb();
  }

  lastSent(): unknown {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }

  clearSent(): void {
    this.sent = [];
  }
}

// --- Helpers ---

function extractInitializeRequest(sent: string[]): JsonRpcRequest | null {
  for (const s of sent) {
    const msg = JSON.parse(s);
    if (msg.method === 'initialize') return msg;
  }
  return null;
}

function extractInitializedNotification(sent: string[]): JsonRpcNotification | null {
  for (const s of sent) {
    const msg = JSON.parse(s);
    if (msg.method === 'initialized') return msg;
  }
  return null;
}

/** Flush microtask queue so async transport.send() calls complete. */
async function flush(): Promise<void> {
  await Promise.resolve();
}

/** Perform the connect + initialize handshake. Returns the initialize request id. */
async function connectClient(transport: MockTransport, client: CodexRpcClient): Promise<number> {
  const connectPromise = client.connect();
  await flush(); // let connect() continuation (which calls call/transport.send) run

  const initReq = extractInitializeRequest(transport.sent);
  expect(initReq).not.toBeNull();
  expect(initReq!.method).toBe('initialize');

  transport.receive({ jsonrpc: '2.0', id: initReq!.id, result: { capabilities: {} } });

  await connectPromise;
  return initReq!.id as number;
}

// --- Tests ---

describe('CodexRpcClient', () => {
  let transport: MockTransport;
  let client: CodexRpcClient;

  beforeEach(() => {
    transport = new MockTransport();
    client = new CodexRpcClient(transport, { defaultTimeout: 500 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------- 4.3 Initialization ----------

  describe('initialize handshake', () => {
    it('should send initialize and initialized on connect', async () => {
      await connectClient(transport, client);

      const initNotif = extractInitializedNotification(transport.sent);
      expect(initNotif).not.toBeNull();
      expect(initNotif!.method).toBe('initialized');
      expect(client.isConnected()).toBe(true);
    });

    it('should reject if initialize fails', async () => {
      const connectPromise = client.connect();
      await flush();

      const initReq = extractInitializeRequest(transport.sent)!;
      expect(initReq).not.toBeNull();
      transport.receive({
        jsonrpc: '2.0',
        id: initReq.id,
        error: { code: -1, message: 'init failed' },
      });

      await expect(connectPromise).rejects.toMatchObject({ message: 'init failed' });
    });

    it('should emit ready event after successful connect', async () => {
      const readyFn = jest.fn();
      client.on('ready', readyFn);

      await connectClient(transport, client);
      expect(readyFn).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- call / response ----------

  describe('call', () => {
    it('should resolve when server responds with result', async () => {
      await connectClient(transport, client);
      transport.clearSent();

      const resultPromise = client.call('thread/list', { limit: 10 });

      const req = transport.lastSent() as JsonRpcRequest;
      expect(req.method).toBe('thread/list');
      expect(req.params).toEqual({ limit: 10 });
      expect(req.id).toBeDefined();

      transport.receive({ jsonrpc: '2.0', id: req.id, result: { items: [] } });

      await expect(resultPromise).resolves.toEqual({ items: [] });
    });

    it('should reject when server responds with error', async () => {
      await connectClient(transport, client);
      transport.clearSent();

      const resultPromise = client.call('bad/method');

      const req = transport.lastSent() as JsonRpcRequest;
      transport.receive({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: 'Method not found' },
      });

      await expect(resultPromise).rejects.toMatchObject({ message: 'Method not found' });
    });

    it('should timeout if no response within timeout', async () => {
      jest.useFakeTimers();
      await connectClient(transport, client);
      transport.clearSent();

      const resultPromise = client.call('slow/method', undefined, 100);

      // Advance past the timeout
      jest.advanceTimersByTime(150);

      await expect(resultPromise).rejects.toThrow('RPC timeout: slow/method after 100ms');
    });

    it('should throw if not connected', async () => {
      await expect(client.call('anything')).rejects.toThrow('RPC client not connected');
    });

    it('should use incrementing IDs', async () => {
      await connectClient(transport, client);
      transport.clearSent();

      const p1 = client.call('a');
      const p2 = client.call('b');
      const p3 = client.call('c');
      const ids = transport.sent.map(s => (JSON.parse(s) as JsonRpcRequest).id);
      expect(ids).toEqual([2, 3, 4]); // 1 was used for initialize

      // Clean up: respond to avoid timeout errors after test
      transport.receive({ jsonrpc: '2.0', id: 2, result: null });
      transport.receive({ jsonrpc: '2.0', id: 3, result: null });
      transport.receive({ jsonrpc: '2.0', id: 4, result: null });
      await Promise.all([p1, p2, p3]);
    });
  });

  // ---------- notifications ----------

  describe('notifications', () => {
    it('should emit notification events by method name', async () => {
      await connectClient(transport, client);

      const handler = jest.fn();
      client.on('notification:thread/started', handler);

      transport.receive({ jsonrpc: '2.0', method: 'thread/started', params: { id: 't1' } });

      expect(handler).toHaveBeenCalledWith({ id: 't1' });
    });

    it('should also emit generic notification event', async () => {
      await connectClient(transport, client);

      const handler = jest.fn();
      client.on('notification', handler);

      transport.receive({ jsonrpc: '2.0', method: 'turn/completed', params: { id: 'tu1' } });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ method: 'turn/completed' }));
    });
  });

  // ---------- server-initiated requests ----------

  describe('server requests', () => {
    it('should dispatch to registered handler and send response', async () => {
      await connectClient(transport, client);
      transport.clearSent();

      client.onServerRequest('item/commandExecution/requestApproval', async (_method, _params) => {
        return { approved: true };
      });

      transport.receive({
        jsonrpc: '2.0',
        id: 'srv-1',
        method: 'item/commandExecution/requestApproval',
        params: { command: 'rm -rf /tmp/junk' },
      });

      // Allow async handler to run
      await new Promise(r => setTimeout(r, 10));

      const response = transport.lastSent() as JsonRpcResponse;
      expect(response.id).toBe('srv-1');
      expect(response.result).toEqual({ approved: true });
    });

    it('should send error response when handler throws', async () => {
      await connectClient(transport, client);
      transport.clearSent();

      client.onServerRequest('failing/method', async () => {
        throw new Error('handler error');
      });

      transport.receive({
        jsonrpc: '2.0', id: 'srv-2', method: 'failing/method', params: {},
      });
      await new Promise(r => setTimeout(r, 10));

      const response = transport.lastSent() as JsonRpcResponse;
      expect(response.id).toBe('srv-2');
      expect(response.error).toMatchObject({ code: -32000, message: 'handler error' });
    });

    it('should respond with method-not-found for unhandled server requests', async () => {
      await connectClient(transport, client);
      transport.clearSent();

      transport.receive({
        jsonrpc: '2.0', id: 'srv-3', method: 'unknown/method', params: {},
      });
      await new Promise(r => setTimeout(r, 10));

      const response = transport.lastSent() as JsonRpcResponse;
      expect(response.id).toBe('srv-3');
      expect(response.error).toMatchObject({ code: -32601 });
    });
  });

  // ---------- disconnect ----------

  describe('disconnect', () => {
    it('should reject all pending calls on transport close', async () => {
      await connectClient(transport, client);

      const p1 = client.call('a');
      const p2 = client.call('b');

      transport.simulateClose();

      await expect(p1).rejects.toThrow('Transport closed');
      await expect(p2).rejects.toThrow('Transport closed');
      expect(client.isConnected()).toBe(false);
    });

    it('should reject all pending on explicit disconnect', async () => {
      await connectClient(transport, client);

      const p1 = client.call('x');

      await client.disconnect();

      await expect(p1).rejects.toThrow('Client disconnected');
      expect(client.isConnected()).toBe(false);
    });

    it('should emit disconnected event on transport close', async () => {
      await connectClient(transport, client);

      const fn = jest.fn();
      client.on('disconnected', fn);

      transport.simulateClose();
      expect(fn).toHaveBeenCalled();
    });
  });

  // ---------- edge cases ----------

  describe('edge cases', () => {
    it('should ignore response for unknown id (no pending)', async () => {
      await connectClient(transport, client);

      // Should not throw
      transport.receive({ jsonrpc: '2.0', id: 'nonexistent', result: 'ok' });
    });

    it('should emit parseError for malformed JSON', async () => {
      const fn = jest.fn();
      client.on('parseError', fn);

      await connectClient(transport, client);
      transport.receive('not-json{{{');

      expect(fn).toHaveBeenCalledWith('not-json{{{');
    });
  });
});
