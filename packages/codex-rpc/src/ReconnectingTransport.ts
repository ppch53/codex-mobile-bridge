import { EventEmitter } from 'events';
import { Transport } from './index';

export interface ReconnectingTransportOptions {
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export class ReconnectingTransport extends EventEmitter implements Transport {
  private inner: Transport;
  private messageListeners: ((data: string) => void)[] = [];
  private closeListeners: (() => void)[] = [];
  private maxRetries: number;
  private baseBackoffMs: number;
  private maxBackoffMs: number;
  private retryCount = 0;
  private reconnecting = false;
  private disposed = false;

  constructor(inner: Transport, options?: ReconnectingTransportOptions) {
    super();
    this.inner = inner;
    this.maxRetries = options?.maxRetries ?? 5;
    this.baseBackoffMs = options?.baseBackoffMs ?? 1000;
    this.maxBackoffMs = options?.maxBackoffMs ?? 30_000;
  }

  async connect(): Promise<void> {
    await this.inner.connect();
    this.retryCount = 0;

    // Wire up inner transport's close to trigger reconnect
    this.inner.onClose(() => {
      if (!this.disposed && !this.reconnecting) {
        this.reconnecting = true;
        this.emit('disconnected');
        this.scheduleReconnect();
      }
    });

    // Wire up message forwarding
    this.inner.onMessage((data) => {
      // Check for -32001 error code (session expired)
      try {
        const msg = JSON.parse(data);
        if (msg.error?.code === -32001) {
          this.emit('sessionExpired');
          if (!this.reconnecting) {
            this.reconnecting = true;
            this.scheduleReconnect();
          }
          return;
        }
      } catch {
        // Not JSON, forward as-is
      }
      for (const cb of this.messageListeners) cb(data);
    });
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.disposed) return;

    this.retryCount++;
    if (this.retryCount > this.maxRetries) {
      this.emit('reconnectFailed', new Error(`Max retries (${this.maxRetries}) exceeded`));
      for (const cb of this.closeListeners) cb();
      return;
    }

    const backoff = Math.min(
      this.baseBackoffMs * Math.pow(2, this.retryCount - 1),
      this.maxBackoffMs
    );
    const jitter = backoff * (0.5 + Math.random() * 0.5);

    this.emit('reconnecting', { attempt: this.retryCount, delayMs: jitter });

    await new Promise(resolve => setTimeout(resolve, jitter));

    if (this.disposed) return;

    try {
      await this.inner.connect();
      this.reconnecting = false;
      this.retryCount = 0;
      this.emit('reconnected');
    } catch (err) {
      this.emit('reconnectError', { attempt: this.retryCount, error: err });
      this.scheduleReconnect();
    }
  }

  async send(message: string): Promise<void> {
    if (this.reconnecting) {
      throw new Error('Transport is reconnecting');
    }
    return this.inner.send(message);
  }

  onMessage(cb: (data: string) => void): void {
    this.messageListeners.push(cb);
  }

  onClose(cb: () => void): void {
    this.closeListeners.push(cb);
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.reconnecting = false;
    await this.inner.disconnect();
  }
}
