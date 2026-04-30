import { CodexAdapter } from './index';

// --- Mock RPC client ---

function createMockRpc() {
  const sent: Array<{ method: string; params?: unknown }> = [];
  const responses = new Map<string, unknown>();

  function mock(method: string, result: unknown) {
    responses.set(method, result);
  }

  const rpc = {
    call: jest.fn(async (method: string, params?: unknown) => {
      sent.push({ method, params });
      if (!responses.has(method)) {
        throw new Error(`No mock for: ${method}`);
      }
      return responses.get(method);
    }),
    sent,
    mock,
  };

  return rpc;
}

// --- Tests ---

describe('CodexAdapter', () => {
  let rpc: ReturnType<typeof createMockRpc>;
  let adapter: CodexAdapter;

  beforeEach(() => {
    rpc = createMockRpc();
    adapter = new CodexAdapter(rpc as unknown as import('@codex-mobile-bridge/codex-rpc').CodexRpcClient);
  });

  // ---------- account/read ----------

  describe('readAccount', () => {
    it('should call account/read and return account info', async () => {
      rpc.mock('account/read', { id: 'acc-1', name: 'Test User', plan: 'pro' });

      const result = await adapter.readAccount();

      expect(rpc.call).toHaveBeenCalledWith('account/read');
      expect(result).toEqual({ id: 'acc-1', name: 'Test User', plan: 'pro' });
    });
  });

  // ---------- thread/list ----------

  describe('listThreads', () => {
    it('should call thread/list with options', async () => {
      rpc.mock('thread/list', {
        items: [{ id: 't1', title: 'First', status: 'active' }],
        nextCursor: 'abc',
      });

      const result = await adapter.listThreads({ limit: 10 });

      expect(rpc.call).toHaveBeenCalledWith('thread/list', { limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('t1');
      expect(result.nextCursor).toBe('abc');
    });

    it('should call thread/list without options', async () => {
      rpc.mock('thread/list', { items: [] });

      await adapter.listThreads();

      expect(rpc.call).toHaveBeenCalledWith('thread/list', undefined);
    });
  });

  // ---------- thread/read ----------

  describe('readThread', () => {
    it('should call thread/read with threadId', async () => {
      rpc.mock('thread/read', { id: 't1', title: 'Test', status: 'active' });

      const result = await adapter.readThread('t1');

      expect(rpc.call).toHaveBeenCalledWith('thread/read', { threadId: 't1', includeTurns: false });
      expect(result.id).toBe('t1');
    });

    it('should pass includeTurns=true when requested', async () => {
      rpc.mock('thread/read', { id: 't1', status: 'active', turns: [] });

      await adapter.readThread('t1', true);

      expect(rpc.call).toHaveBeenCalledWith('thread/read', { threadId: 't1', includeTurns: true });
    });
  });

  // ---------- thread/start ----------

  describe('startThread', () => {
    it('should call thread/start and return thread summary', async () => {
      rpc.mock('thread/start', { id: 't-new', status: 'active' });

      const result = await adapter.startThread({ prompt: 'Hello' });

      expect(rpc.call).toHaveBeenCalledWith('thread/start', { prompt: 'Hello' });
      expect(result.id).toBe('t-new');
    });

    it('should work without options', async () => {
      rpc.mock('thread/start', { id: 't-new', status: 'active' });

      await adapter.startThread();

      expect(rpc.call).toHaveBeenCalledWith('thread/start', undefined);
    });
  });

  // ---------- thread/resume ----------

  describe('resumeThread', () => {
    it('should call thread/resume', async () => {
      rpc.mock('thread/resume', { id: 't1', status: 'active' });

      const result = await adapter.resumeThread('t1');

      expect(rpc.call).toHaveBeenCalledWith('thread/resume', { threadId: 't1' });
      expect(result.id).toBe('t1');
    });
  });

  // ---------- turn/start ----------

  describe('startTurn', () => {
    it('should call turn/start with threadId and input', async () => {
      rpc.mock('turn/start', { id: 'tu-1', threadId: 't1', status: 'running' });

      const result = await adapter.startTurn('t1', 'Hello Codex');

      expect(rpc.call).toHaveBeenCalledWith('turn/start', { threadId: 't1', input: 'Hello Codex' });
      expect(result.id).toBe('tu-1');
      expect(result.threadId).toBe('t1');
    });

    it('should pass optional modelId', async () => {
      rpc.mock('turn/start', { id: 'tu-2', threadId: 't1', status: 'running' });

      await adapter.startTurn('t1', 'test', { modelId: 'gpt-4' });

      expect(rpc.call).toHaveBeenCalledWith('turn/start', {
        threadId: 't1',
        input: 'test',
        modelId: 'gpt-4',
      });
    });
  });

  // ---------- turn/steer ----------

  describe('steerTurn', () => {
    it('should call turn/steer', async () => {
      rpc.mock('turn/steer', undefined);

      await adapter.steerTurn('t1', 'tu-1', 'add more detail');

      expect(rpc.call).toHaveBeenCalledWith('turn/steer', {
        threadId: 't1',
        turnId: 'tu-1',
        input: 'add more detail',
      });
    });
  });

  // ---------- turn/interrupt ----------

  describe('interruptTurn', () => {
    it('should call turn/interrupt', async () => {
      rpc.mock('turn/interrupt', undefined);

      await adapter.interruptTurn('t1', 'tu-1');

      expect(rpc.call).toHaveBeenCalledWith('turn/interrupt', { threadId: 't1', turnId: 'tu-1' });
    });
  });

  // ---------- error propagation ----------

  describe('error propagation', () => {
    it('should propagate RPC errors', async () => {
      rpc.call.mockRejectedValueOnce({ code: -32601, message: 'Method not found' });

      await expect(adapter.readAccount()).rejects.toMatchObject({ message: 'Method not found' });
    });
  });
});
