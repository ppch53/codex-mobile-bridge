import { ApprovalEngine } from './ApprovalEngine';
import { LocalStore } from '@codex-mobile-bridge/store';
import fs from 'fs';
import path from 'path';

describe('ApprovalEngine', () => {
  const testDbPath = path.join(__dirname, 'test-approval.json');
  let store: LocalStore;
  let engine: ApprovalEngine;

  beforeEach(async () => {
    store = new LocalStore(testDbPath);
    await store.initialize();
    engine = new ApprovalEngine(store, 5000); // 5s timeout for tests
  });

  afterEach(() => {
    engine.stop();
    store.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('should create a pending request on submit', async () => {
    const resultPromise = engine.submit({
      id: 'req-1',
      type: 'commandExecution',
      threadId: 't-1',
      data: { command: 'ls' },
    });

    expect(engine.pendingCount).toBe(1);

    // Resolve to avoid hanging
    await engine.resolve('req-1', true);
    await resultPromise;
  });

  it('should resolve pending request and return approval result', async () => {
    const resultPromise = engine.submit({
      id: 'req-1',
      type: 'commandExecution',
      threadId: 't-1',
      data: { command: 'ls' },
    });

    // Simulate approval
    await engine.resolve('req-1', true);

    const result = await resultPromise;
    expect(result.approved).toBe(true);
  });

  it('should handle rejection', async () => {
    const resultPromise = engine.submit({
      id: 'req-1',
      type: 'commandExecution',
      threadId: 't-1',
      data: { command: 'rm -rf /' },
    });

    await engine.resolve('req-1', false, 'user rejected');

    const result = await resultPromise;
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('user rejected');
  });

  it('should auto-reject on timeout', async () => {
    jest.useFakeTimers();

    const resultPromise = engine.submit({
      id: 'req-1',
      type: 'commandExecution',
      threadId: 't-1',
      data: {},
    });

    engine.start();

    // Advance past the expiration
    jest.advanceTimersByTime(10_000);

    const result = await resultPromise;
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('timeout');

    jest.useRealTimers();
  });

  it('should track pending count', async () => {
    expect(engine.pendingCount).toBe(0);

    const p1 = engine.submit({ id: 'r1', type: 'test', threadId: 't1', data: {} });
    expect(engine.pendingCount).toBe(1);

    const p2 = engine.submit({ id: 'r2', type: 'test', threadId: 't1', data: {} });
    expect(engine.pendingCount).toBe(2);

    await engine.resolve('r1', true);
    expect(engine.pendingCount).toBe(1);

    await engine.resolve('r2', false);
    expect(engine.pendingCount).toBe(0);

    await Promise.all([p1, p2]);
  });

  it('should return false when resolving unknown request', async () => {
    const result = await engine.resolve('nonexistent', true);
    expect(result).toBe(false);
  });

  it('should emit events on lifecycle', async () => {
    const events: string[] = [];
    engine.on('approval:pending', () => events.push('pending'));
    engine.on('approval:resolved', () => events.push('resolved'));

    const resultPromise = engine.submit({
      id: 'req-1',
      type: 'test',
      threadId: 't-1',
      data: {},
    });

    expect(events).toContain('pending');

    await engine.resolve('req-1', true);
    expect(events).toContain('resolved');

    await resultPromise;
  });

  it('should reject all pending on stop', async () => {
    const resultPromise = engine.submit({
      id: 'req-1',
      type: 'test',
      threadId: 't-1',
      data: {},
    });

    engine.stop();

    await expect(resultPromise).rejects.toThrow('Approval engine stopped');
  });

  it('should throw when submitting after stop', async () => {
    engine.stop();
    await expect(engine.submit({
      id: 'req-1',
      type: 'test',
      threadId: 't-1',
      data: {},
    })).rejects.toThrow('Approval engine stopped');
  });
});
