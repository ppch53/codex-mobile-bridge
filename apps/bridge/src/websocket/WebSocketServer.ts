import { WebSocketServer as WsServer, WebSocket } from 'ws';
import { EventRouter, CodexEvent, ApprovalEngine } from '@codex-mobile-bridge/mobile-core';
import { AuthGuard, PolicyEngine, Redactor } from '@codex-mobile-bridge/security';
import { LocalStore } from '@codex-mobile-bridge/store';
import type { PaginatedResult, ThreadSummary, TurnSummary } from '@codex-mobile-bridge/codex-adapter';

interface BridgeAdapter {
  listThreads(options?: { limit?: number; cursor?: string }): Promise<PaginatedResult<ThreadSummary>>;
  startTurn(threadId: string, input: string): Promise<TurnSummary>;
  interruptTurn(threadId: string, turnId?: string): Promise<void>;
}

interface ClientInfo {
  deviceId: string;
  userId: string;
  subscribedThreads: Set<string>;
  activeTurnId?: string;
  isAlive: boolean;
}

export class WebSocketServer {
  private server: WsServer | null = null;
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    private port: number,
    private eventRouter: EventRouter,
    private authGuard: AuthGuard,
    private store: LocalStore,
    private adapter: BridgeAdapter,
    private approvalEngine: ApprovalEngine,
    private policyEngine?: PolicyEngine,
    private redactor?: Redactor
  ) {}

  start(): void {
    this.server = new WsServer({ port: this.port });
    this.server.on('connection', async (ws, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(1008, 'Missing token');
        return;
      }
      const auth = await this.authGuard.authenticateDevice(token);
      if (!auth) {
        ws.close(1008, 'Invalid token');
        return;
      }
      this.clients.set(ws, {
        deviceId: token,
        userId: auth.userId,
        subscribedThreads: new Set(),
        isAlive: true,
      });

      ws.on('message', (data) => this.handleMessage(ws, data));
      ws.on('pong', () => {
        const info = this.clients.get(ws);
        if (info) info.isAlive = true;
      });
      ws.on('close', () => this.clients.delete(ws));
    });

    // Subscribe to events and broadcast
    this.eventRouter.on((event: CodexEvent) => {
      this.broadcastEvent(event);
    });

    // Heartbeat
    this.heartbeatInterval = setInterval(() => {
      if (!this.server) return;
      for (const [ws, info] of this.clients.entries()) {
        if (!info.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        info.isAlive = false;
        ws.ping();
      }
    }, 30_000);
    this.heartbeatInterval.unref?.();

    console.log(`WebSocket server listening on port ${this.port}`);
  }

  private handleMessage(ws: WebSocket, raw: unknown): void {
    const info = this.clients.get(ws);
    if (!info) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw as string);
    } catch {
      this.sendResponse(ws, undefined, undefined, 'Invalid JSON');
      return;
    }

    const type = msg.type as string | undefined;
    const requestId = msg.requestId as string | undefined;

    switch (type) {
      case 'ping':
        this.sendMessage(ws, { type: 'pong' });
        break;

      case 'open':
        if (msg.threadId) {
          info.subscribedThreads.add(msg.threadId as string);
        }
        this.sendResponse(ws, requestId, { subscribed: msg.threadId });
        break;

      case 'close-thread':
        if (msg.threadId) {
          info.subscribedThreads.delete(msg.threadId as string);
        }
        this.sendResponse(ws, requestId, { unsubscribed: msg.threadId });
        break;

      case 'list':
        this.handleList(ws, requestId);
        break;

      case 'send':
        this.handleSend(ws, info, requestId, msg.threadId as string, msg.text as string);
        break;

      case 'interrupt':
        this.handleInterrupt(ws, info, requestId, msg.threadId as string, msg.turnId as string | undefined);
        break;

      case 'approve':
        if (msg.approvalRequestId && typeof msg.approved === 'boolean') {
          this.handleApproval(ws, info, requestId, msg.approvalRequestId as string, msg.approved as boolean);
        } else {
          this.sendResponse(ws, requestId, undefined, 'Missing approvalRequestId or approved');
        }
        break;

      default:
        this.sendResponse(ws, requestId, undefined, `Unknown message type: ${type}`);
    }
  }

  private async handleApproval(
    ws: WebSocket,
    info: ClientInfo,
    requestId: string | undefined,
    approvalRequestId: string,
    approved: boolean
  ): Promise<void> {
    try {
      const pending = await this.store.getPendingRequest(approvalRequestId);
      if (!pending) {
        this.sendResponse(ws, requestId, undefined, 'Request not found');
        return;
      }
      if (pending.resolved) {
        this.sendResponse(ws, requestId, undefined, 'Already resolved');
        return;
      }

      // Check dangerous command
      if (approved && this.policyEngine && pending.type === 'item/commandExecution/requestApproval') {
        const command = (pending.data as Record<string, unknown>)?.command;
        if (command) {
          const policy = this.policyEngine.evaluateCommand(command as string);
          if (policy.requiresSecondConfirmation) {
            this.sendResponse(ws, requestId, {
              secondConfirmationRequired: true,
              command,
              approvalRequestId,
            });
            return;
          }
        }
      }

      const resolved = await this.approvalEngine.resolve(approvalRequestId, approved);
      if (!resolved) {
        this.sendResponse(ws, requestId, undefined, 'Failed to resolve');
        return;
      }

      await this.store.addAuditLog(
        info.userId,
        `approval.${approved ? 'approve' : 'reject'}`,
        'request',
        approvalRequestId,
        approved ? 'approved' : 'rejected'
      );
      this.sendResponse(ws, requestId, { resolved: true, approved });
    } catch (err) {
      this.sendResponse(ws, requestId, undefined, `Approval failed: ${err}`);
    }
  }

  private async handleList(ws: WebSocket, requestId: string | undefined): Promise<void> {
    try {
      const result = await this.adapter.listThreads({ limit: 20 });
      this.sendResponse(ws, requestId, result);
    } catch (err) {
      this.sendResponse(ws, requestId, undefined, `List failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleSend(ws: WebSocket, info: ClientInfo, requestId: string | undefined, threadId: string, text: string): Promise<void> {
    if (!threadId || !text) {
      this.sendResponse(ws, requestId, undefined, 'Missing threadId or text');
      return;
    }
    try {
      const turn = await this.adapter.startTurn(threadId, text);
      info.activeTurnId = turn.id;
      this.sendResponse(ws, requestId, turn);
    } catch (err) {
      this.sendResponse(ws, requestId, undefined, `Send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleInterrupt(ws: WebSocket, info: ClientInfo, requestId: string | undefined, threadId: string, turnId?: string): Promise<void> {
    const effectiveTurnId = turnId || info.activeTurnId;
    if (!threadId || !effectiveTurnId) {
      this.sendResponse(ws, requestId, undefined, 'Missing threadId or turnId');
      return;
    }
    try {
      await this.adapter.interruptTurn(threadId, effectiveTurnId);
      info.activeTurnId = undefined;
      this.sendResponse(ws, requestId, { interrupted: true });
    } catch (err) {
      this.sendResponse(ws, requestId, undefined, `Interrupt failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private broadcastEvent(event: CodexEvent): void {
    const payload = JSON.stringify({ type: 'event', event });
    for (const [ws, info] of this.clients.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // Send thread-specific events only to subscribed clients
      if (event.threadId && !info.subscribedThreads.has(event.threadId)) continue;
      ws.send(payload);
    }
  }

  private sendResponse(ws: WebSocket, requestId: string | undefined, data?: unknown, error?: string): void {
    if (!requestId) return;
    this.sendMessage(ws, { type: 'response', requestId, data, error });
  }

  private sendMessage(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.server) {
      for (const ws of this.clients.keys()) {
        ws.close(1001, 'Server shutting down');
      }
      this.clients.clear();
      this.server.close();
      this.server = null;
    }
  }
}
