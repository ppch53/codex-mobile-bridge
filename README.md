# Codex Mobile Bridge

A bridge service that connects the Codex CLI/app-server to mobile clients (Telegram and Web/PWA), enabling remote monitoring, message sending, and approval management from your phone.

## Features

- **Telegram Bot**: Full command interface for thread management, message sending, and approval handling
- **Web/PWA**: Mobile-friendly web interface with real-time event streaming
- **Approval Engine**: Timeout-based approval management with dangerous command detection
- **Event Routing**: Centralized event bus connecting Codex, Telegram, and Web clients
- **Security**: Device pairing, user authentication, policy enforcement, and secret redaction
- **Auto-Reconnect**: WebSocket transport with exponential backoff for reliable connections
- **Windows Service**: Run as a background service with automatic restart on failure
- **Standalone Executable**: Single `.exe` packaging — no Node.js installation required on the target machine

## Architecture

```
apps/
  bridge/       Main entry point, HTTP/WS servers
  web/          PWA frontend
packages/
  codex-rpc/    JSON-RPC 2.0 client (stdio + WebSocket transports)
  codex-adapter/ Codex API method wrappers
  mobile-core/  EventRouter, ThreadPresenter, ApprovalEngine
  store/        LocalStore (SQLite via better-sqlite3)
  security/     AuthGuard, PolicyEngine, Redactor
  telegram/     Grammy-based Telegram bot
  diagnostics/  Health checks
```

## Prerequisites

- **Node.js** >= 18 (for development and running from source)
- **Codex CLI** installed and logged in (`codex auth status` to verify)
- **Telegram Bot Token** from [@BotFather](https://t.me/BotFather) (optional, for Telegram integration)

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npx tsc --build

# Configure
cp .env.example .env
# Edit .env with your settings

# Run
npm start
```

## Windows Service

Install the bridge as a Windows service that starts automatically on boot:

```powershell
# Build and package first
npm run build
npm run package:windows

# Install (requires Administrator)
powershell -ExecutionPolicy Bypass -File scripts/install-service.ps1

# Check status
powershell -ExecutionPolicy Bypass -File scripts/bridge-status.ps1

# Uninstall (requires Administrator)
powershell -ExecutionPolicy Bypass -File scripts/uninstall-service.ps1
```

The service automatically restarts on failure (5s, 10s, 30s backoff). Logs are written to `%LOCALAPPDATA%\CodexMobileBridge\logs\`.

## Building Standalone Executable

```bash
npm run build
npm run package:windows
```

This produces `dist/codex-mobile-bridge.exe` — a self-contained Windows x64 executable that bundles Node.js and all dependencies. No Node.js installation required on the target machine.

## Configuration

See `.env.example` for all available settings. Key options:

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_TRANSPORT` | `auto` | Transport mode: `auto`, `stdio`, `websocket` |
| `CODEX_BINARY` | `codex` | Path to Codex CLI binary |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token from BotFather |
| `WEB_ENABLED` | `true` | Enable Web/PWA interface |
| `WEB_PORT` | `8765` | WebSocket server port |
| `HTTP_PORT` | `3000` | HTTP server port |
| `APPROVAL_TIMEOUT_SECONDS` | `300` | Approval request timeout |
| `REDACT_SECRETS` | `true` | Enable secret redaction in output |

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/list` | Show recent threads |
| `/open <id>` | Open a thread |
| `/new` | Create a new thread |
| `/send <text>` | Send message to current thread |
| `/steer <text>` | Add input to active turn |
| `/interrupt` | Interrupt current turn |
| `/pair` | Generate Web pairing code |
| `/status` | Show bridge status |
| `/account` | Show Codex account info |
| `/settings` | Show security settings |

## Security

See [SECURITY.md](SECURITY.md) for the full security policy and [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the architecture.

- All output is scanned for secrets before reaching clients (`REDACT_SECRETS=true` by default)
- Commands in `ALLOWED_WORKSPACES` are restricted to those directories
- Dangerous commands require explicit user approval
- Run `node scripts/check-secrets.js` to verify no secrets are committed to source

## Development

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run E2E tests (mock mode)
npm run test:e2e:mock

# Type check
npm run typecheck

# Lint
npm run lint
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bridge can't connect to Codex | Ensure Codex Desktop/CLI is running. Try `CODEX_TRANSPORT=stdio` |
| Telegram bot not responding | Check `TELEGRAM_BOT_TOKEN` in `.env`. Verify with BotFather |
| Web client can't pair | Ensure bridge is running and HTTP port 3000 is reachable |
| Service won't start | Check `%LOCALAPPDATA%\CodexMobileBridge\logs\service-crash.log` |

See [docs/SOP.md](docs/SOP.md) for detailed operational procedures.

## License

MIT
