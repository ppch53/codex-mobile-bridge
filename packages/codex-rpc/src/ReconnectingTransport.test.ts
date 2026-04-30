import { ReconnectingTransport } from './ReconnectingTransport';
import { Transport } from './index';

class MockTransport implements Transport {
  private messageListeners: ((data: string) => void)[] = [];
  private closeListeners: (() => void)[] = [];
  public sent: string[] = [];
  public connectCount = 0;
  private shouldFailConnect = false;

  async connect(): Promise<void> {
    if (this.shouldFailConnect) {
      throw new Error('Connection refused');
    }
    this.connectCount++;
  }

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
  simulateClose(): void {
    for (const cb of this.closeListeners) cb();
  }

  receive(data: unknown): void {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    for (const cb of this.messageListeners) cb(str);
  }

  setFailConnect(fail: boolean): void {
    this.shouldFailConnect = fail;
  }
}

describe('ReconnectingTransport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should forward messages from inner transport', async () => {
    const inner = new MockTransport();
    const transport = new ReconnectingTransport(inner, { maxRetries: 0 });

    const received: string[] = [];
    transport.onMessage((data) => received.push(data));

    await transport.connect();
    inner.receive({ jsonrpc: '2.0', method: 'test', params: {} });

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]).method).toBe('test');
  });

  it('should forward send to inner transport', async () => {
    const inner = new MockTransport();
    const transport = new ReconnectingTransport(inner, { maxRetries: 0 });

    await transport.connect();
    await transport.send('hello');

    expect(inner.sent).toEqual(['hello']);
  });

  it('should attempt reconnect on close', async () => {
    const inner = new MockTransport();
    const transport = new ReconnectingTransport(inner, { maxRetries: 3, baseBackoffMs: 100 });

    const reconnectingFn = jest.fn();
    const reconnectedFn = jest.fn();
    transport.on('reconnecting', reconnectingFn);
    transport.on('reconnected', reconnectedFn);

    await transport.connect();
    expect(inner.connectCount).toBe(1);

    inner.simulateClose();

    // Advance timer for first reconnect attempt
    await jest.advanceTimersByTimeAsync(150);
    expect(inner.connectCount).toBe(2);
    expect(reconnectingFn).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
    expect(reconnectedFn).toHaveBeenCalled();
  });

  it('should emit reconnectFailed after max retries', async () => {
    const inner = new MockTransport();
    const transport = new ReconnectingTransport(inner, { maxRetries: 2, baseBackoffMs: 100 });

    const failedFn = jest.fn();
    transport.on('reconnectFailed', failedFn);

    await transport.connect();
    inner.setFailConnect(true);
    inner.simulateClose();

    // Let all retries happen
    await jest.advanceTimersByTimeAsync(1000);

    expect(failedFn).toHaveBeenCalled();
    expect(inner.connectCount).toBe(1); // Only initial connect succeeded
  });

  it('should handle -32001 error as session expired', async () => {
    const inner = new MockTransport();
    const transport = new ReconnectingTransport(inner, { maxRetries: 1, baseBackoffMs: 100 });

    const expiredFn = jest.fn();
    const reconnectedFn = jest.fn();
    transport.on('sessionExpired', expiredFn);
    transport.on('reconnected', reconnectedFn);

    const received: string[] = [];
    transport.onMessage((data) => received.push(data));

    await transport.connect();

    // Send a -32001 error
    inner.receive({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'session expired' } });

    expect(expiredFn).toHaveBeenCalled();
    // The error message should NOT be forwarded to listeners
    expect(received).toHaveLength(0);

    // Let reconnect happen
    await jest.advanceTimersByTimeAsync(200);
    expect(reconnectedFn).toHaveBeenCalled();
  });

  it('should throw when sending during reconnect', async () => {
    const inner = new MockTransport();
    const transport = new ReconnectingTransport(inner, { maxRetries: 3, baseBackoffMs: 100 });

    await transport.connect();
    inner.setFailConnect(true);
    inner.simulateClose();

    await expect(transport.send('test')).rejects.toThrow('Transport is reconnecting');
  });

  it('should use exponential backoff', async () => {
    const inner = new MockTransport();
    const transport = new ReconnectingTransport(inner, { maxRetries: 3, baseBackoffMs: 100, maxBackoffMs: 10000 });

    const delays: number[] = [];
    transport.on('reconnecting', (info: any) => delays.push(info.delayMs));

    await transport.connect();

    // Trigger multiple failures
    inner.setFailConnect(true);
    inner.simulateClose();

    // Advance timers for all retries
    await jest.advanceTimersByTimeAsync(30000);

    // Should have attempted reconnection
    expect(delays.length).toBeGreaterThanOrEqual(2);
  });

  it('should reset retry count on successful reconnect', async () => {
    const inner = new MockTransport();
    const transport = new ReconnectingTransport(inner, { maxRetries: 5, baseBackoffMs: 100 });

    await transport.connect();
    expect(inner.connectCount).toBe(1);

    // First disconnect - should reconnect
    inner.simulateClose();
    await jest.advanceTimersByTimeAsync(200);
    expect(inner.connectCount).toBe(2);

    // Second disconnect - should still have retries available (count reset)
    inner.simulateClose();
    await jest.advanceTimersByTimeAsync(200);
    expect(inner.connectCount).toBe(3);
  });

  it('should clean up on disconnect', async () => {
    const inner = new MockTransport();
    const transport = new ReconnectingTransport(inner, { maxRetries: 3, baseBackoffMs: 100 });

    await transport.connect();
    await transport.disconnect();

    // Simulating close after disconnect should NOT trigger reconnect
    inner.simulateClose();
    await jest.advanceTimersByTimeAsync(1000);
    // No error, no reconnect attempts
    expect(inner.connectCount).toBe(1);
  });
});
