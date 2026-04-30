/**
 * Mock Codex app-server for integration testing and local demos.
 *
 * Supports:
 * - JSON-RPC 2.0 over WebSocket
 * - initialize/initialized handshake
 * - account/read, thread/list, thread/read, thread/start, turn/start, turn/interrupt
 * - Emits turn events (turn/started, item/agentMessage/delta, item/completed, turn/completed)
 * - Can send server-initiated approval requests
 *
 * Usage:
 *   const server = new MockAppServer({ port: 4500 });
 *   await server.start();
 *   // ... run tests ...
 *   await server.stop();
 */

import { WebSocketServer, WebSocket } from 'ws';

export interface MockThread {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MockAppServerOptions {
  port?: number;
  /** Delay in ms before sending turn events (default: 50) */
  eventDelay?: number;
  /** If set, send an approval request this many ms after turn/start */
  approvalDelay?: number;
  /** The command to include in the approval request */
  approvalCommand?: string;
  /** Pre-configured threads */
  threads?: MockThread[];
}

const DEFAULT_THREADS: MockThread[] = [
  { id: 'thread-001', title: 'Fix login bug', status: 'active', createdAt: '2026-04-29T10:00:00Z', updatedAt: '2026-04-29T12:00:00Z' },
  { id: 'thread-002', title: 'Add dark mode', status: 'completed', createdAt: '2026-04-28T09:00:00Z', updatedAt: '2026-04-28T15:00:00Z' },
  { id: 'thread-003', title: 'Refactor auth module', status: 'active', createdAt: '2026-04-27T14:00:00Z', updatedAt: '2026-04-29T11:00:00Z' },
];

export class MockAppServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private port: number;
  private eventDelay: number;
  private approvalDelay: number | null;
  private approvalCommand: string;
  private threads: MockThread[];
  private nextTurnId = 1;
  private nextItemId = 1;

  constructor(options: MockAppServerOptions = {}) {
    this.port = options.port ?? 4500;
    this.eventDelay = options.eventDelay ?? 50;
    this.approvalDelay = options.approvalDelay ?? null;
    this.approvalCommand = options.approvalCommand ?? 'rm -rf /tmp/test';
    this.threads = options.threads ?? [...DEFAULT_THREADS];
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port });
      this.wss.on('connection', (ws) => this.handleConnection(ws));
      this.wss.on('listening', () => resolve());
    });
  }

  async stop(): Promise<void> {
    for (const ws of this.clients) {
      ws.close();
    }
    this.clients.clear();
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  get address(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(ws, msg);
      } catch {
        // ignore malformed messages
      }
    });
  }

  private handleMessage(ws: WebSocket, msg: Record<string, unknown>): void {
    const method = msg.method as string | undefined;
    const id = msg.id;

    // Notifications (no id) - just acknowledge silently
    if (id === undefined && method) {
      if (method === 'initialized') {
        // Handshake complete, no response needed
      }
      return;
    }

    // Requests (have id)
    if (method && id !== undefined) {
      switch (method) {
        case 'initialize':
          this.sendResult(ws, id, {
            protocolVersion: '0.1.0',
            capabilities: {},
            serverInfo: { name: 'mock-codex', version: '0.1.0' },
          });
          return;

        case 'account/read':
          this.sendResult(ws, id, {
            id: 'acct-mock-001',
            name: 'Test User',
            email: 'test@example.com',
            plan: 'pro',
          });
          return;

        case 'thread/list': {
          const params = (msg.params as Record<string, unknown>) || {};
          const limit = (params.limit as number) || 20;
          const items = this.threads.slice(0, limit);
          this.sendResult(ws, id, { items, nextCursor: undefined });
          return;
        }

        case 'thread/read': {
          const params = (msg.params as Record<string, unknown>) || {};
          const threadId = params.threadId as string;
          const thread = this.threads.find(t => t.id === threadId);
          if (!thread) {
            this.sendError(ws, id, -32001, `Thread not found: ${threadId}`);
            return;
          }
          this.sendResult(ws, id, { ...thread, turns: [] });
          return;
        }

        case 'thread/start': {
          const params = (msg.params as Record<string, unknown>) || {};
          const newThread: MockThread = {
            id: `thread-${Date.now()}`,
            title: (params.prompt as string) || 'New thread',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          this.threads.unshift(newThread);
          this.sendResult(ws, id, newThread);
          return;
        }

        case 'turn/start': {
          const params = (msg.params as Record<string, unknown>) || {};
          const threadId = params.threadId as string;
          const turnId = `turn-${this.nextTurnId++}`;
          this.sendResult(ws, id, { id: turnId, threadId, status: 'started' });
          // Emit turn events asynchronously
          this.emitTurnEvents(ws, threadId, turnId, params.input as string);
          return;
        }

        case 'turn/interrupt': {
          const params = (msg.params as Record<string, unknown>) || {};
          this.sendResult(ws, id, { status: 'interrupted' });
          this.sendNotification(ws, 'turn/completed', {
            threadId: params.threadId,
            turnId: params.turnId,
            status: 'interrupted',
          });
          return;
        }

        default:
          this.sendError(ws, id, -32601, `Method not found: ${method}`);
          return;
      }
    }

    // Responses to server-initiated requests (have id, no method)
    // These are approval responses from the client
    if (id !== undefined && !method) {
      // Approval response - just acknowledge
      return;
    }
  }

  private async emitTurnEvents(ws: WebSocket, threadId: string, turnId: string, input?: string): Promise<void> {
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // turn/started
    this.sendNotification(ws, 'turn/started', { threadId, turnId });
    await delay(this.eventDelay);

    // If approval is configured, send an approval request
    if (this.approvalDelay !== null) {
      await delay(this.approvalDelay);
      const serverReqId = `srv-${Date.now()}`;
      this.sendServerRequest(ws, serverReqId, 'item/commandExecution/requestApproval', {
        threadId,
        turnId,
        command: this.approvalCommand,
        cwd: '/tmp',
        reason: 'Command requires approval',
      });
      // Wait for the client to respond before continuing
      // The response will come back as a regular message and be handled by handleMessage
      // We don't await it here - the turn events will continue after a timeout
      await delay(this.eventDelay * 10); // Give time for approval
    }

    // item/started (assistant message)
    const itemId = `item-${this.nextItemId++}`;
    this.sendNotification(ws, 'item/started', {
      threadId, turnId, itemId, type: 'agentMessage',
    });
    await delay(this.eventDelay);

    // item/agentMessage/delta (stream the response)
    const responseText = input
      ? `Echo: ${input}\n\nThis is a mock response from Codex. The turn completed successfully.`
      : 'Hello from mock Codex! This is a simulated response.';

    const words = responseText.split(' ');
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join(' ') + ' ';
      this.sendNotification(ws, 'item/agentMessage/delta', {
        threadId, turnId, itemId, delta: chunk,
      });
      await delay(this.eventDelay);
    }

    // item/completed
    this.sendNotification(ws, 'item/completed', {
      threadId, turnId, itemId, type: 'agentMessage', content: responseText,
    });
    await delay(this.eventDelay);

    // turn/completed
    this.sendNotification(ws, 'turn/completed', {
      threadId, turnId, status: 'completed',
      usage: { promptTokens: 100, completionTokens: 50 },
    });
  }

  private sendResult(ws: WebSocket, id: unknown, result: unknown): void {
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  private sendError(ws: WebSocket, id: unknown, code: number, message: string): void {
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
  }

  private sendNotification(ws: WebSocket, method: string, params: unknown): void {
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  private sendServerRequest(ws: WebSocket, id: string, method: string, params: unknown): void {
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  }
}
