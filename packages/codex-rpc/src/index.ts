import { EventEmitter } from 'events';

// --- JSON-RPC types ---

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown>;

// --- Transport interface ---

export interface Transport {
  send(message: string): Promise<void>;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// --- StdioTransport ---

export class StdioTransport implements Transport {
  private proc?: import('child_process').ChildProcess;
  private messageListeners: ((data: string) => void)[] = [];
  private closeListeners: (() => void)[] = [];
  private buffer = '';

  constructor(private binaryPath: string, private args: string[]) {}

  async connect(): Promise<void> {
    const { spawn } = await import('child_process');
    return new Promise<void>((resolve, reject) => {
      try {
        this.proc = spawn(this.binaryPath, this.args, { stdio: ['pipe', 'pipe', 'inherit'] });
      } catch (err) {
        reject(err);
        return;
      }

      this.proc.on('error', (err) => {
        reject(err);
      });

      this.proc.on('spawn', () => {
        resolve();
      });

      this.proc.stdout?.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString();
        let newlineIdx: number;
        while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, newlineIdx).replace(/\r$/, '');
          this.buffer = this.buffer.slice(newlineIdx + 1);
          if (line.trim()) {
            for (const cb of this.messageListeners) cb(line);
          }
        }
      });
      this.proc.on('close', () => {
        for (const cb of this.closeListeners) cb();
      });
    });
  }

  async send(message: string): Promise<void> {
    if (!this.proc?.stdin) throw new Error('Process not connected');
    this.proc.stdin.write(message + '\n');
  }

  onMessage(cb: (data: string) => void): void {
    this.messageListeners.push(cb);
  }

  onClose(cb: () => void): void {
    this.closeListeners.push(cb);
  }

  async disconnect(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = undefined;
    }
  }
}

// --- CodexRpcClient ---

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CodexRpcClientOptions {
  defaultTimeout?: number;
}

export class CodexRpcClient extends EventEmitter {
  private connected = false;
  private nextId = 1;
  private pending = new Map<string | number, PendingRequest>();
  private serverRequestHandlers = new Map<string, ServerRequestHandler>();
  private defaultTimeout: number;
  private transport: Transport;

  constructor(transport: Transport, options?: CodexRpcClientOptions) {
    super();
    this.transport = transport;
    this.defaultTimeout = options?.defaultTimeout ?? 30_000;

    this.transport.onMessage((data) => {
      try {
        const msg = JSON.parse(data);
        this.dispatch(msg);
      } catch {
        this.emit('parseError', data);
      }
    });

    this.transport.onClose(() => {
      this.connected = false;
      this.rejectAllPending(new Error('Transport closed'));
      this.emit('disconnected');
    });
  }

  // --- Public API ---

  async connect(): Promise<void> {
    await this.transport.connect();
    this.connected = true;
    this.emit('connected');

    await this.call('initialize', {
      processId: process.pid,
      capabilities: {},
    });

    this.notify('initialized', {});
    this.emit('ready');
  }

  async disconnect(): Promise<void> {
    this.rejectAllPending(new Error('Client disconnected'));
    await this.transport.disconnect();
    this.connected = false;
  }

  async call(method: string, params?: unknown, timeout?: number): Promise<unknown> {
    if (!this.connected) throw new Error('RPC client not connected');

    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} after ${timeout ?? this.defaultTimeout}ms`));
      }, timeout ?? this.defaultTimeout);

      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(JSON.stringify(request)).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.connected) throw new Error('RPC client not connected');
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    this.transport.send(JSON.stringify(msg)).catch((err) => {
      this.emit('error', err);
    });
  }

  onServerRequest(method: string, handler: ServerRequestHandler): void {
    this.serverRequestHandlers.set(method, handler);
  }

  isConnected(): boolean {
    return this.connected;
  }

  // --- Internal dispatch ---

  private dispatch(msg: Record<string, unknown>): void {
    const hasId = msg.id !== undefined;
    const hasMethod = typeof msg.method === 'string';

    // Response to a pending request
    if (hasId && !hasMethod) {
      const pending = this.pending.get(msg.id as string | number);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id as string | number);
        if (msg.error) {
          pending.reject(msg.error);
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Server-initiated request (has both id and method)
    if (hasId && hasMethod) {
      this.handleServerRequest(msg as unknown as JsonRpcRequest);
      return;
    }

    // Notification (has method, no id)
    if (!hasId && hasMethod) {
      this.emit(`notification:${msg.method}`, msg.params);
      this.emit('notification', msg);
      return;
    }

    this.emit('message', msg);
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this.serverRequestHandlers.get(request.method);

    if (!handler) {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      };
      await this.transport.send(JSON.stringify(response));
      return;
    }

    try {
      const result = await handler(request.method, request.params);
      const response: JsonRpcResponse = { jsonrpc: '2.0', id: request.id, result };
      await this.transport.send(JSON.stringify(response));
    } catch (err) {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      };
      await this.transport.send(JSON.stringify(response));
    }
  }

  private rejectAllPending(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}

export { WebSocketTransport } from './WebSocketTransport';
export type { WebSocketTransportOptions } from './WebSocketTransport';
export { ReconnectingTransport } from './ReconnectingTransport';
export type { ReconnectingTransportOptions } from './ReconnectingTransport';
