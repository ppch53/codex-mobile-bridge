import { loadConfig, ensureDirectories } from './config';
import { LocalStore } from '@codex-mobile-bridge/store';
import { AuthGuard, PolicyEngine, Redactor } from '@codex-mobile-bridge/security';
import { CodexRpcClient, StdioTransport, WebSocketTransport, ReconnectingTransport, Transport } from '@codex-mobile-bridge/codex-rpc';
import { CodexAdapter, APPROVAL_METHODS } from '@codex-mobile-bridge/codex-adapter';
import { EventRouter, ApprovalEngine } from '@codex-mobile-bridge/mobile-core';
import { WebSocketServer } from './websocket/WebSocketServer';
import { createHttpServer } from './http/server';
import http from 'http';
import net from 'net';

async function probeWebSocketPorts(host: string, ports: number[], timeoutMs = 300): Promise<number | null> {
  for (const port of ports) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
    });
    if (ok) return port;
  }
  return null;
}

async function createTransport(config: ReturnType<typeof loadConfig>): Promise<Transport> {
  const mode = config.CODEX_TRANSPORT;

  if (mode === 'websocket') {
    console.log(`Using WebSocket transport: ${config.CODEX_WS_URL}`);
    const ws = new WebSocketTransport({ url: config.CODEX_WS_URL });
    return new ReconnectingTransport(ws);
  }

  if (mode === 'stdio') {
    console.log(`Using stdio transport: ${config.CODEX_BINARY}`);
    return new StdioTransport(config.CODEX_BINARY, config.CODEX_ARGS);
  }

  // auto mode: probe WebSocket ports 4500, 9234-9237, then fall back to stdio
  console.log('Auto-detecting transport...');
  const ports = [4500, 9234, 9235, 9236, 9237];
  const found = await probeWebSocketPorts('127.0.0.1', ports);
  if (found) {
    const wsUrl = `ws://127.0.0.1:${found}`;
    console.log(`  Found Codex app-server at ${wsUrl}`);
    const ws = new WebSocketTransport({ url: wsUrl });
    return new ReconnectingTransport(ws);
  }
  console.log('  No WebSocket app-server found, falling back to stdio');
  return new StdioTransport(config.CODEX_BINARY, config.CODEX_ARGS);
}

export async function main() {
  const config = loadConfig();
  ensureDirectories(config);

  console.log('Codex Mobile Bridge starting...');
  console.log(`  Codex home: ${config.CODEX_HOME}`);
  console.log(`  Data dir: ${config.BRIDGE_DATA_DIR}`);
  console.log(`  Log dir: ${config.BRIDGE_LOG_DIR}`);

  // Initialize store
  const store = new LocalStore(config.DB_PATH);
  await store.initialize();
  console.log('  Store initialized (SQLite)');

  // Initialize security components
  const authGuard = new AuthGuard(store, config.TELEGRAM_ALLOWED_USERS ?? []);
  const policyEngine = new PolicyEngine(config.ALLOWED_WORKSPACES, config.DANGEROUS_COMMAND_CONFIRM);
  const redactor = new Redactor(config.REDACT_SECRETS);

  // Initialize Codex RPC client
  const transport = await createTransport(config);
  const rpcClient = new CodexRpcClient(transport);
  const adapter = new CodexAdapter(rpcClient);

  // Initialize event router and approval engine
  const eventRouter = new EventRouter();
  const approvalEngine = new ApprovalEngine(store, config.APPROVAL_TIMEOUT_SECONDS * 1000);
  approvalEngine.start();

  // Register server request handlers for approval flow
  for (const method of APPROVAL_METHODS) {
    rpcClient.onServerRequest(method, async (_method: string, params: unknown) => {
      const requestId = `apr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const paramsObj = params as Record<string, unknown> | undefined;

      eventRouter.emit({
        type: 'approval/request',
        threadId: paramsObj?.threadId as string | undefined,
        content: { requestId, method, params },
      });

      const result = await approvalEngine.submit({
        id: requestId,
        type: method,
        threadId: (paramsObj?.threadId as string) || 'unknown',
        turnId: paramsObj?.turnId as string | undefined,
        data: params,
      });

      return result;
    });
  }

  // --- Start local servers FIRST (independent of Codex) ---

  // Start WebSocket server for web clients
  let wsServer: WebSocketServer | null = null;
  if (config.WEB_ENABLED) {
    wsServer = new WebSocketServer(
      config.WEB_PORT,
      eventRouter,
      authGuard,
      store,
      adapter,
      approvalEngine,
      policyEngine,
      redactor
    );
    wsServer.start();
    console.log(`  WebSocket server: ws://127.0.0.1:${config.WEB_PORT}`);
  }

  // Start HTTP server for pairing API
  const httpApp = createHttpServer(authGuard, store, { webSocketPort: config.WEB_PORT });
  const httpServer = http.createServer(httpApp);
  httpServer.listen(config.HTTP_PORT, config.WEB_BIND_HOST, () => {
    console.log(`  HTTP server: http://${config.WEB_BIND_HOST}:${config.HTTP_PORT}`);
  });

  // --- Then attempt Codex connection (non-fatal if it fails) ---

  // Forward Codex notifications (turn/*, item/*) to EventRouter so Telegram/Web receive real-time events
  rpcClient.on('notification', (msg: Record<string, unknown>) => {
    const method = msg.method as string | undefined;
    if (!method) return;
    const params = (msg.params as Record<string, unknown>) || {};

    if (method.startsWith('turn/') || method.startsWith('item/')) {
      eventRouter.emit({
        type: method,
        threadId: params.threadId as string | undefined,
        turnId: params.turnId as string | undefined,
        itemId: params.itemId as string | undefined,
        delta: params.delta as string | undefined,
        content: params.content as string | undefined,
        status: params.status as string | undefined,
      });
    }
  });

  let codexConnected = false;
  try {
    await rpcClient.connect();
    codexConnected = true;
    console.log('  Codex app-server: CONNECTED');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  Codex app-server: OFFLINE (${msg})`);
    console.log('  Bridge running in degraded mode. Codex features unavailable.');
    console.log('  Start Codex Desktop/CLI and restart the bridge to connect.');
  }

  // Start Telegram bot if enabled
  let telegramBot: unknown = null;
  if (config.TELEGRAM_ENABLED && config.TELEGRAM_BOT_TOKEN) {
    try {
      const { TelegramBot } = await import('@codex-mobile-bridge/telegram');
      telegramBot = new TelegramBot(
        config.TELEGRAM_BOT_TOKEN,
        adapter,
        store,
        authGuard,
        eventRouter,
        config.TELEGRAM_ALLOWED_USERS ?? [],
        approvalEngine,
        config.ALLOWED_WORKSPACES,
        policyEngine,
        redactor
      );
      await (telegramBot as { start: () => Promise<void> }).start();
      console.log('  Telegram bot: STARTED');
    } catch (err) {
      console.log(`  Telegram bot: FAILED (${err instanceof Error ? err.message : String(err)})`);
    }
  } else {
    console.log('  Telegram bot: DISABLED (no token configured)');
  }

  console.log('');
  console.log(`Bridge ready. Status: Codex=${codexConnected ? 'connected' : 'offline'}, Web=enabled, Telegram=${telegramBot ? 'running' : 'disabled'}`);
  console.log('Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    approvalEngine.stop();
    if (telegramBot) await (telegramBot as { stop: () => Promise<void> }).stop();
    if (wsServer) wsServer.stop();
    httpServer.close();
    await rpcClient.disconnect();
    store.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
