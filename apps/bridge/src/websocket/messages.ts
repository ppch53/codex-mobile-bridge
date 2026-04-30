// Client → Server messages
export type ClientMessage =
  | { type: 'ping' }
  | { type: 'open'; requestId?: string; threadId: string }
  | { type: 'close-thread'; requestId?: string; threadId: string }
  | { type: 'approve'; requestId?: string; approvalRequestId: string; approved: boolean };

// Server → Client messages
export type ServerMessage =
  | { type: 'pong' }
  | { type: 'response'; requestId: string; data?: unknown; error?: string }
  | { type: 'event'; event: import('@codex-mobile-bridge/mobile-core').CodexEvent };
