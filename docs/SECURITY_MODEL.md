# Security Model

## Threat Model

The bridge handles sensitive operations: executing commands on a remote machine, accessing code repositories, and managing approval workflows. The primary threats are:

1. **Unauthorized Access**: Someone connecting to the bridge without permission
2. **Command Injection**: Malicious commands being executed via Codex
3. **Secret Leakage**: API keys or credentials appearing in output
4. **Replay Attacks**: Captured tokens being reused

## Authentication

### Telegram
- Bot token set via `TELEGRAM_BOT_TOKEN` environment variable
- User access restricted to IDs in `ALLOWED_TELEGRAM_USER_IDS`
- Each message authenticated via Telegram's built-in user ID

### Web/PWA
- Pairing code generated via Telegram bot (`/pair` command)
- 6-digit code verified via HTTP API, returns device ID as token
- Token passed as WebSocket query parameter on each connection
- Device registration stored in LocalStore

## Authorization

### PolicyEngine
- Commands evaluated against `ALLOWED_WORKSPACES` directory list
- `DANGEROUS_COMMAND_CONFIRM` flag enables second confirmation for risky commands
- Dangerous patterns: `rm -rf`, `sudo`, `chmod 777`, `eval`, `curl | sh`

### Approval Flow
- All Codex server requests require explicit user approval
- 5-minute timeout with auto-rejection
- All approvals logged in audit trail with timestamp, user, action, target, result

## Data Protection

### Secret Redaction
- `Redactor` scans all output text before sending to clients
- Patterns detected: API keys (`sk-`, `AKIA`), bearer tokens, passwords, private keys
- Replacement: `[REDACTED:type]` where type indicates what was found

### Storage
- All data stored locally in SQLite database (`state.db`) via better-sqlite3
- Uses WAL journal mode for concurrent read performance
- No external database or cloud storage
- Audit log entries are append-only

## Network Security

### Transport
- stdio: No network exposure for Codex communication
- WebSocket: Token authentication, heartbeat (30s ping), idle disconnect (40s)
- HTTP: CORS headers, pairing endpoints only

### Rate Limiting
- No built-in rate limiting (relies on reverse proxy in production)
- Approval timeout prevents indefinite resource holding

## Recommendations for Production

1. Run behind a reverse proxy (nginx) with TLS termination
2. Set `WEB_BIND_HOST=127.0.0.1` and use proxy for external access
3. Restrict `ALLOWED_TELEGRAM_USER_IDS` to known users
4. Enable `REDACT_SECRETS=true`
5. Set `DANGEROUS_COMMAND_CONFIRM=true`
6. Regularly review audit logs
