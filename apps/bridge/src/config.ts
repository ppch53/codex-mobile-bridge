import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  NODE_ENV: string;
  LOG_LEVEL: string;

  // Codex transport
  CODEX_TRANSPORT: 'auto' | 'stdio' | 'websocket';
  CODEX_BINARY: string;
  CODEX_ARGS: string[];
  CODEX_HOME: string;
  CODEX_WS_URL: string;
  CODEX_WS_AUTH_TOKEN_FILE: string;

  // Storage
  DB_PATH: string;
  BRIDGE_DATA_DIR: string;
  BRIDGE_LOG_DIR: string;

  // Workspaces
  ALLOWED_WORKSPACES: string[];

  // Telegram
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALLOWED_USERS?: string[];
  TELEGRAM_ENABLED: boolean;
  TELEGRAM_POLLING: boolean;

  // Web
  WEB_ENABLED: boolean;
  WEB_BIND_HOST: string;
  WEB_PORT: number;
  WEB_REQUIRE_PAIRING: boolean;
  HTTP_PORT: number;

  // Security
  APPROVAL_TIMEOUT_SECONDS: number;
  DANGEROUS_COMMAND_CONFIRM: boolean;
  MAX_TELEGRAM_MESSAGE_CHARS: number;
  REDACT_SECRETS: boolean;
}

export function loadConfig(): Config {
  const appData = process.env.APPDATA || process.env.HOME || '.';
  const localAppData = process.env.LOCALAPPDATA || appData;

  const dbPath = process.env.BRIDGE_DATA_DIR
    ? path.join(process.env.BRIDGE_DATA_DIR, 'state.db')
    : path.join(appData, 'CodexMobileBridge', 'state.db');

  const allowedWorkspaces = process.env.ALLOWED_WORKSPACES
    ? process.env.ALLOWED_WORKSPACES.split(';').filter(Boolean)
    : [process.cwd()];

  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',

    CODEX_TRANSPORT: (process.env.CODEX_TRANSPORT as Config['CODEX_TRANSPORT']) || 'auto',
    CODEX_BINARY: process.env.CODEX_BINARY || 'codex',
    CODEX_ARGS: process.env.CODEX_ARGS?.split(' ').filter(Boolean) || [],
    CODEX_HOME: process.env.CODEX_HOME || path.join(process.env.USERPROFILE || appData, '.codex'),
    CODEX_WS_URL: process.env.CODEX_WS_URL || 'ws://127.0.0.1:4500',
    CODEX_WS_AUTH_TOKEN_FILE: process.env.CODEX_WS_AUTH_TOKEN_FILE || '',

    DB_PATH: dbPath,
    BRIDGE_DATA_DIR: process.env.BRIDGE_DATA_DIR || path.join(appData, 'CodexMobileBridge'),
    BRIDGE_LOG_DIR: process.env.BRIDGE_LOG_DIR || path.join(localAppData, 'CodexMobileBridge', 'logs'),

    ALLOWED_WORKSPACES: allowedWorkspaces,

    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_ALLOWED_USERS: process.env.ALLOWED_TELEGRAM_USER_IDS?.split(',').filter(Boolean),
    TELEGRAM_ENABLED: process.env.TELEGRAM_BOT_TOKEN !== undefined && process.env.TELEGRAM_BOT_TOKEN !== 'replace_me',
    TELEGRAM_POLLING: process.env.TELEGRAM_POLLING !== 'false',

    WEB_ENABLED: process.env.WEB_ENABLED !== 'false',
    WEB_BIND_HOST: process.env.WEB_BIND_HOST || '127.0.0.1',
    WEB_PORT: parseInt(process.env.WEB_PORT || '8765', 10),
    WEB_REQUIRE_PAIRING: process.env.WEB_REQUIRE_PAIRING !== 'false',
    HTTP_PORT: parseInt(process.env.HTTP_PORT || '3000', 10),

    APPROVAL_TIMEOUT_SECONDS: parseInt(process.env.APPROVAL_TIMEOUT_SECONDS || '300', 10),
    DANGEROUS_COMMAND_CONFIRM: process.env.DANGEROUS_COMMAND_CONFIRM !== 'false',
    MAX_TELEGRAM_MESSAGE_CHARS: parseInt(process.env.MAX_TELEGRAM_MESSAGE_CHARS || '3800', 10),
    REDACT_SECRETS: process.env.REDACT_SECRETS !== 'false',
  };
}

export function ensureDirectories(config: Config): void {
  const dirs = [path.dirname(config.DB_PATH), config.BRIDGE_LOG_DIR];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
