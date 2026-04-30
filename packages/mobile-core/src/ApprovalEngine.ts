import { EventEmitter } from 'events';
import type { LocalStore } from '@codex-mobile-bridge/store';

export interface ApprovalSubmission {
  id: string;
  type: string;
  threadId: string;
  turnId?: string;
  data: unknown;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
}

export class ApprovalEngine extends EventEmitter {
  private timeoutMs: number;
  private scannerInterval: NodeJS.Timeout | null = null;
  private stopped = false;
  private pendingPromises: Map<string, {
    resolve: (result: ApprovalResult) => void;
    reject: (err: Error) => void;
  }> = new Map();

  constructor(
    private store: LocalStore,
    private timeoutMsValue?: number
  ) {
    super();
    this.timeoutMs = timeoutMsValue ?? 300_000; // 5 minutes default
  }

  start(): void {
    this.scannerInterval = setInterval(() => this.scanExpired(), 10_000);
    this.scannerInterval.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.scannerInterval) {
      clearInterval(this.scannerInterval);
      this.scannerInterval = null;
    }
    // Reject all pending
    for (const [, { reject }] of this.pendingPromises.entries()) {
      reject(new Error('Approval engine stopped'));
    }
    this.pendingPromises.clear();
  }

  async submit(submission: ApprovalSubmission): Promise<ApprovalResult> {
    if (this.stopped) {
      throw new Error('Approval engine stopped');
    }

    const requestId = submission.id;
    const expiresAt = Date.now() + this.timeoutMs;

    // Register promise before any awaits so stop() can always reject it
    const resultPromise = new Promise<ApprovalResult>((resolve, reject) => {
      this.pendingPromises.set(requestId, { resolve, reject });
    });

    // Fire-and-forget: store write should not block the approval flow
    this.store.addPendingRequest({
      id: requestId,
      type: submission.type,
      threadId: submission.threadId,
      turnId: submission.turnId,
      data: submission.data,
      expiresAt,
    }).catch(() => {});

    this.emit('approval:pending', { requestId, submission });

    return resultPromise;
  }

  async resolve(requestId: string, approved: boolean, reason?: string): Promise<boolean> {
    const result: ApprovalResult = { approved, reason };

    const resolved = await this.store.resolvePendingRequest(requestId, result);
    if (!resolved) return false;

    const pending = this.pendingPromises.get(requestId);
    if (pending) {
      pending.resolve(result);
      this.pendingPromises.delete(requestId);
    }

    this.emit('approval:resolved', { requestId, result });
    return true;
  }

  private async scanExpired(): Promise<void> {
    const now = Date.now();
    // We need to scan all pending requests
    // Since LocalStore doesn't have a "get all pending" method,
    // we use the pendingPromises map to track what we're waiting for
    for (const [requestId, { resolve }] of this.pendingPromises.entries()) {
      const req = await this.store.getPendingRequest(requestId);
      if (req && !req.resolved && req.expiresAt < now) {
        const result: ApprovalResult = { approved: false, reason: 'timeout' };
        await this.store.resolvePendingRequest(requestId, result);
        resolve(result);
        this.pendingPromises.delete(requestId);
        this.emit('approval:timeout', { requestId });
      }
    }
  }

  get pendingCount(): number {
    return this.pendingPromises.size;
  }
}
