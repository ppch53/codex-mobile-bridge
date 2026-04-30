# Research: Codex app-server Protocol & Integration

**Date**: 2026-04-27
**Status**: Complete

## Sources

1. OpenAI Developers: Codex App Server (accessed 2026-04-27)
2. OpenAI Developers: Codex Open Source (accessed 2026-04-27)
3. GitHub: openai/codex (accessed 2026-04-27)
4. Telegram Bot API (accessed 2026-04-27)

## Key Findings

### Codex app-server Protocol

- **Transport**: JSON-RPC 2.0 over stdio (default) or WebSocket (experimental, loopback only)
- **Handshake**: Client must send `initialize` then `initialized` notification after connection
- **Core methods**: `thread/start`, `thread/resume`, `thread/read`, `thread/list`, `turn/start`, `turn/steer`, `turn/interrupt`
- **Events**: Running turns emit `turn/*`, `item/*`, token usage events continuously
- **Server requests**: Commands, file changes, permissions, MCP requests arrive as server-initiated JSON-RPC requests (with `id`) requiring client response

### Transport Decisions

| Mode | Pros | Cons |
|------|------|------|
| stdio | Official default, no port exposure, lifecycle management | Cannot share with existing Desktop process |
| WebSocket | Can connect to existing listener | Experimental, must use 127.0.0.1 only |

**Decision**: Support both stdio and loopback WebSocket. Auto-detect at startup (try WebSocket first, fall back to stdio). Never expose app-server to non-localhost.

### Security Constraints

- Bridge must NOT read/write Codex auth.json, state databases, or session files directly
- All interaction goes through app-server JSON-RPC API
- Approval requests have timeouts; unhandled requests block the turn
- Telegram callback_data limited to 64 bytes; requires short-ID mapping
- Telegram messages limited to 4096 characters; requires pagination

### Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebSocket experimental | Connection instability | ReconnectingTransport with exponential backoff |
| Codex API changes | Broken adapter | Contract tests, schema generation, startup self-check |
| Desktop + Bridge concurrent access | State conflicts | Read app-server status, only steer/interrupt when active |
| Telegram rate limits (429) | Message delivery failure | Retry with backoff, queue system |
