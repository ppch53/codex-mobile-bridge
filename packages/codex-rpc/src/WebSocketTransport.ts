import WebSocket from 'ws';
import { Transport } from './index';

export interface WebSocketTransportOptions {
  url: string;
  authToken?: string;
  connectTimeoutMs?: number;
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private messageListeners: ((data: string) => void)[] = [];
  private closeListeners: (() => void)[] = [];
  private url: string;
  private authToken?: string;
  private connectTimeoutMs: number;

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url;
    this.authToken = options.authToken;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`WebSocket connect timeout after ${this.connectTimeoutMs}ms`));
        if (this.ws) {
          this.ws.removeAllListeners();
          this.ws.close();
          this.ws = null;
        }
      }, this.connectTimeoutMs);

      const headers: Record<string, string> = {};
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      this.ws = new WebSocket(this.url, { headers });

      this.ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        const text = typeof data === 'string' ? data : data.toString();
        for (const cb of this.messageListeners) cb(text);
      });

      this.ws.on('close', () => {
        for (const cb of this.closeListeners) cb();
      });
    });
  }

  async send(message: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    return new Promise<void>((resolve, reject) => {
      this.ws!.send(message, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  onMessage(cb: (data: string) => void): void {
    this.messageListeners.push(cb);
  }

  onClose(cb: () => void): void {
    this.closeListeners.push(cb);
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }
}
