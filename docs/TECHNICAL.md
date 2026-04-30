# Technical Architecture

## Overview

Codex Mobile Bridge is a TypeScript monorepo that acts as a middleware between the Codex app-server (CLI) and mobile clients (Telegram, Web/PWA).

## Communication Flow

```
Codex App-Server  <--stdio/ws-->  Bridge Server  <--ws-->  Web Clients
                                       |
                                  <--HTTP-->  Telegram API
```

### JSON-RPC 2.0

All communication with Codex uses JSON-RPC 2.0 over either stdio or WebSocket. The `CodexRpcClient` handles:

- Request/response correlation via incrementing IDs
- Server-initiated requests (approvals)
- Notifications (events)
- Initialize handshake

### Transport Layer

Three transport implementations:

1. **StdioTransport**: Spawns Codex binary, communicates via stdin/stdout
2. **WebSocketTransport**: Connects to Codex's WebSocket endpoint with optional auth
3. **ReconnectingTransport**: Wraps any transport with exponential backoff (1s to 30s), handles -32001 session expired errors

## Packages

### `codex-rpc`
Low-level JSON-RPC 2.0 client. Manages request IDs, timeouts, and transport lifecycle.

### `codex-adapter`
High-level API wrapping Codex RPC methods: `listThreads`, `readThread`, `startThread`, `startTurn`, `steerTurn`, `interruptTurn`, `readAccount`.

### `mobile-core`
- **EventRouter**: EventEmitter-based pub/sub with typed listeners
- **MessageAccumulator**: Aggregates streaming deltas into complete messages
- **splitMessage**: Splits long messages for Telegram's 4096-char limit
- **ThreadPresenter**: Formats thread data for display
- **ApprovalEngine**: Manages approval lifecycle with timeout scanning

### `store`
SQLite persistence via better-sqlite3 with WAL journal mode. Supports devices, users, audit log, pending requests, thread bindings, and event offsets. Schema versioned with migration system.

### `security`
- **AuthGuard**: Device pairing (6-digit codes) and Telegram user authentication
- **PolicyEngine**: Evaluates commands against workspace rules and dangerous patterns
- **Redactor**: Scans text for secrets (API keys, tokens, passwords) and replaces with `[REDACTED]`

### `telegram`
Grammy-based Telegram bot with session middleware. Handles all user commands and approval flow via inline keyboards.

### `diagnostics`
Health check system that verifies RPC connection, store accessibility, and service status.

## Data Flow: Approval

1. Codex sends a server request (e.g., `item/commandExecution/requestApproval`)
2. Bridge creates a `PendingRequest` in the store
3. EventRouter emits `approval/request` event
4. Telegram/Web clients receive the event and display approval UI
5. User approves/rejects via inline button or WebSocket message
6. Bridge resolves the `PendingRequest` and returns result to Codex
7. If timeout (5 min default), auto-rejects

## WebSocket Protocol

Client messages:
- `{ type: 'open', threadId }` — Subscribe to thread events
- `{ type: 'close-thread', threadId }` — Unsubscribe
- `{ type: 'approve', approvalRequestId, approved }` — Approve/reject
- `{ type: 'ping' }` — Keepalive

Server messages:
- `{ type: 'response', requestId, data?, error? }` — Response to client request
- `{ type: 'event', event }` — Real-time Codex event
- `{ type: 'pong' }` — Keepalive response
