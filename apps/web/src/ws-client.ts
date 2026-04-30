type MessageHandler = (msg: { type: string; [key: string]: unknown }) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private pendingRequests: Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }> = new Map();
  private nextRequestId = 1;
  private _connected = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private url: string) {}

  get connected(): boolean {
    return this._connected;
  }

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.url}?token=${encodeURIComponent(token)}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this._connected = true;
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25_000);
        resolve();
      };

      this.ws.onerror = () => {
        if (!this._connected) reject(new Error('Connection failed'));
      };

      this.ws.onclose = () => {
        this._connected = false;
        if (this.pingInterval) clearInterval(this.pingInterval);
        // Reject all pending
        for (const [, p] of this.pendingRequests) {
          p.reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
        // Notify handlers of disconnect
        for (const h of this.handlers) {
          h({ type: 'disconnected' });
        }
      };

      this.ws.onmessage = (ev) => {
        let msg: { type: string; [key: string]: unknown };
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }

        // Handle responses to our requests
        if (msg.type === 'response' && msg.requestId) {
          const pending = this.pendingRequests.get(msg.requestId as string);
          if (pending) {
            this.pendingRequests.delete(msg.requestId as string);
            if (msg.error) {
              pending.reject(new Error(msg.error as string));
            } else {
              pending.resolve(msg.data);
            }
          }
        }

        // Forward all messages to handlers
        for (const h of this.handlers) {
          h(msg);
        }
      };
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  offMessage(handler: MessageHandler): void {
    this.handlers = this.handlers.filter(h => h !== handler);
  }

  async send(type: string, data: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }
    const requestId = `r${this.nextRequestId++}`;
    const msg = { type, requestId, ...data };
    this.ws.send(JSON.stringify(msg));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 30_000);
      this.pendingRequests.set(requestId, {
        resolve: (d) => { clearTimeout(timeout); resolve(d); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });
    });
  }

  sendNoResponse(type: string, data: Record<string, unknown> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, ...data }));
  }

  disconnect(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }
}
