import { loadConfig } from './config';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return sensible defaults', () => {
    const config = loadConfig();
    expect(config.CODEX_TRANSPORT).toBe('auto');
    expect(config.CODEX_BINARY).toBe('codex');
    expect(config.WEB_PORT).toBe(8765);
    expect(config.HTTP_PORT).toBe(3000);
    expect(config.APPROVAL_TIMEOUT_SECONDS).toBe(300);
    expect(config.DANGEROUS_COMMAND_CONFIRM).toBe(true);
    expect(config.REDACT_SECRETS).toBe(true);
    expect(config.MAX_TELEGRAM_MESSAGE_CHARS).toBe(3800);
    expect(config.WEB_REQUIRE_PAIRING).toBe(true);
    expect(config.WEB_BIND_HOST).toBe('127.0.0.1');
  });

  it('should read env vars correctly', () => {
    process.env.CODEX_TRANSPORT = 'websocket';
    process.env.CODEX_WS_URL = 'ws://127.0.0.1:9999';
    process.env.WEB_PORT = '5555';
    process.env.APPROVAL_TIMEOUT_SECONDS = '60';

    const config = loadConfig();
    expect(config.CODEX_TRANSPORT).toBe('websocket');
    expect(config.CODEX_WS_URL).toBe('ws://127.0.0.1:9999');
    expect(config.WEB_PORT).toBe(5555);
    expect(config.APPROVAL_TIMEOUT_SECONDS).toBe(60);
  });

  it('should parse ALLOWED_WORKSPACES from semicolon-separated string', () => {
    process.env.ALLOWED_WORKSPACES = 'C:\\Projects;D:\\Work;E:\\Test';

    const config = loadConfig();
    expect(config.ALLOWED_WORKSPACES).toEqual(['C:\\Projects', 'D:\\Work', 'E:\\Test']);
  });

  it('should detect TELEGRAM_ENABLED from token', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const config1 = loadConfig();
    expect(config1.TELEGRAM_ENABLED).toBe(false);

    process.env.TELEGRAM_BOT_TOKEN = 'real-token';
    const config2 = loadConfig();
    expect(config2.TELEGRAM_ENABLED).toBe(true);

    process.env.TELEGRAM_BOT_TOKEN = 'replace_me';
    const config3 = loadConfig();
    expect(config3.TELEGRAM_ENABLED).toBe(false);
  });

  it('should parse TELEGRAM_ALLOWED_USERS', () => {
    process.env.ALLOWED_TELEGRAM_USER_IDS = '111,222,333';
    const config = loadConfig();
    expect(config.TELEGRAM_ALLOWED_USERS).toEqual(['111', '222', '333']);
  });
});
