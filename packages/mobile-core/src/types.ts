export type { CodexEvent } from './EventRouter';

export interface ThreadSummary {
  id: string;
  title?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ThreadDetail extends ThreadSummary {
  turns?: unknown[];
}
