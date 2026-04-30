import type { CodexRpcClient } from '@codex-mobile-bridge/codex-rpc';

// --- Codex app-server types (thread/turn/item model) ---

export interface ThreadSummary {
  id: string;
  title?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ThreadDetail extends ThreadSummary {
  turns?: TurnSummary[];
}

export interface TurnSummary {
  id: string;
  threadId: string;
  status: string;
  input?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface TurnItem {
  id: string;
  type: string;
  content?: unknown;
  status?: string;
}

export interface AccountInfo {
  id: string;
  name?: string;
  email?: string;
  plan?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
}

export interface ListOptions {
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
}

export interface StartThreadOptions {
  modelId?: string;
  workspace?: string;
  prompt?: string;
}

export interface StartTurnOptions {
  modelId?: string;
}

// --- CodexAdapter ---

export const APPROVAL_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
  'mcpServer/elicitation/request',
];

export class CodexAdapter {
  constructor(private rpcClient: CodexRpcClient) {}

  // --- Read operations ---

  async readAccount(): Promise<AccountInfo> {
    const result = await this.rpcClient.call('account/read');
    return result as AccountInfo;
  }

  async listThreads(options?: ListOptions): Promise<PaginatedResult<ThreadSummary>> {
    const result = await this.rpcClient.call('thread/list', options);
    return result as PaginatedResult<ThreadSummary>;
  }

  async readThread(threadId: string, includeTurns = false): Promise<ThreadDetail> {
    const result = await this.rpcClient.call('thread/read', { threadId, includeTurns });
    return result as ThreadDetail;
  }

  // --- Write operations ---

  async startThread(options?: StartThreadOptions): Promise<ThreadSummary> {
    const result = await this.rpcClient.call('thread/start', options);
    return result as ThreadSummary;
  }

  async resumeThread(threadId: string): Promise<ThreadSummary> {
    const result = await this.rpcClient.call('thread/resume', { threadId });
    return result as ThreadSummary;
  }

  async startTurn(threadId: string, input: string, options?: StartTurnOptions): Promise<TurnSummary> {
    const result = await this.rpcClient.call('turn/start', { threadId, input, ...options });
    return result as TurnSummary;
  }

  async steerTurn(threadId: string, turnId: string, input: string): Promise<void> {
    await this.rpcClient.call('turn/steer', { threadId, turnId, input });
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.rpcClient.call('turn/interrupt', { threadId, turnId });
  }
}
