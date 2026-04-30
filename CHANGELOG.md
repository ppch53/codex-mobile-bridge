# Changelog

## [1.0.0] - 2026-04-30

### Added
- JSON-RPC 2.0 client with stdio and WebSocket transports
- ReconnectingTransport with exponential backoff and -32001 session handling
- CodexAdapter with full Codex API wrappers (threads, turns, account)
- EventRouter pub/sub event system with MessageAccumulator and splitMessage
- LocalStore SQLite persistence via better-sqlite3 with WAL journal mode
- AuthGuard with device pairing and Telegram authentication
- PolicyEngine for workspace and dangerous command evaluation
- Redactor for secret detection and redaction
- ApprovalEngine with timeout scanning and promise-based resolution
- ThreadPresenter for thread formatting
- Telegram Bot with all commands: /list, /open, /new, /send, /steer, /interrupt, /pair, /status, /account, /settings
- Telegram event forwarding with delta accumulation and message splitting
- Telegram approval inline keyboard with dangerous command second confirmation
- WebSocket server with authentication, message protocol, event broadcasting, and heartbeat
- Web/PWA frontend with pairing, thread list, thread detail, message sending, and approval cards
- HTTP server for pairing API and static file serving
- Diagnostics module with real health checks
- Configuration management with environment variables
- Windows service support via PowerShell install/uninstall scripts
- Standalone executable packaging with `@yao-pkg/pkg`
- Security bypass tests for PolicyEngine (path traversal, prefix collision, UNC paths)
- Redactor gap documentation tests (AWS keys, GitHub PATs, JWTs, PEM keys)
- Integration tests: fault injection (transport disconnect, malformed messages, concurrent requests, approval timeout)
- Integration tests: end-to-end redaction flow (CodexAdapter output, WebSocket event pipeline)
- CI coverage thresholds enforcement (75% global, 85% security package)
- Secret scanning script with 6 pattern categories
- 256 unit tests across 18 test suites, 22 integration tests across 3 suites
