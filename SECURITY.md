# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email the maintainers privately at security@example.com with details
3. Include steps to reproduce and potential impact
4. We will respond within 72 hours

## Security Model

### Authentication

- **Telegram**: User ID allowlist (`ALLOWED_TELEGRAM_USER_IDS`)
- **Web**: Device pairing via 6-digit code generated through Telegram bot
- **WebSocket**: Token-based authentication passed as query parameter

### Authorization

- **PolicyEngine**: Evaluates commands against workspace allowlists and dangerous command rules
- **Dangerous Command Confirmation**: Commands matching dangerous patterns require explicit user approval
- **Audit Log**: All approval actions are logged with user ID, action, target, and result

### Data Protection

- **Secret Redaction**: `Redactor` scans output for API keys, tokens, passwords, and other secrets
- **Local Storage**: All data stored locally in SQLite database via better-sqlite3, no external database
- **No Telemetry**: The bridge does not send data to external services

### Transport Security

- **stdio**: Communication with Codex app-server is via local stdio (no network)
- **WebSocket**: Token authentication, heartbeat monitoring, automatic disconnect on idle
- **HTTP**: CORS enabled, pairing endpoints validate codes

## Dependencies

We regularly audit dependencies for known vulnerabilities. Run `npm audit` to check current status.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x | Yes |
| < 1.0 | No |
