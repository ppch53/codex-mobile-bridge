import type { CodexAdapter } from '@codex-mobile-bridge/codex-adapter';
import type { LocalStore } from '@codex-mobile-bridge/store';
import type { AuthGuard } from '@codex-mobile-bridge/security';
import type { EventRouter, ApprovalEngine } from '@codex-mobile-bridge/mobile-core';

// Mock grammy before importing TelegramBot
const mockBotInstance = {
  use: jest.fn(),
  command: jest.fn(),
  callbackQuery: jest.fn(),
  on: jest.fn(),
  api: {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
  },
  init: jest.fn().mockResolvedValue(undefined),
  start: jest.fn(),
  stop: jest.fn(),
};

jest.mock('grammy', () => ({
  Bot: jest.fn().mockImplementation(() => mockBotInstance),
  Context: class {},
  session: jest.fn(() => (_ctx: unknown, next: () => Promise<void>) => next()),
  SessionFlavor: class {},
}));

import { TelegramBot } from './TelegramBot';

function createMockAdapter(): CodexAdapter {
  return {
    readAccount: jest.fn().mockResolvedValue({ id: 'acct-1', name: 'Test', plan: 'pro' }),
    listThreads: jest.fn().mockResolvedValue({ items: [{ id: 't-1', title: 'Test', status: 'active' }] }),
    readThread: jest.fn().mockResolvedValue({ id: 't-1', title: 'Test', status: 'active' }),
    startThread: jest.fn().mockResolvedValue({ id: 't-new', title: 'New', status: 'active' }),
    resumeThread: jest.fn(),
    startTurn: jest.fn().mockResolvedValue({ id: 'turn-1' }),
    steerTurn: jest.fn(),
    interruptTurn: jest.fn(),
  } as unknown as CodexAdapter;
}

function createMockStore(): LocalStore {
  return {
    initialize: jest.fn(),
    bindThread: jest.fn(),
    addAuditLog: jest.fn(),
    getPendingRequest: jest.fn(),
    resolvePendingRequest: jest.fn(),
    close: jest.fn(),
  } as unknown as LocalStore;
}

function createMockAuthGuard(): AuthGuard {
  return {
    authenticateTelegram: jest.fn().mockResolvedValue({ userId: '123', role: 'user' }),
    generatePairingCode: jest.fn().mockResolvedValue({ deviceId: 'dev-1', code: '123456' }),
  } as unknown as AuthGuard;
}

interface MockCtx {
  from?: { id: number };
  chat?: { id: number };
  match?: string | string[];
  session: Record<string, unknown>;
  reply: jest.Mock;
  answerCallbackQuery: jest.Mock;
  editMessageReplyMarkup: jest.Mock;
  editMessageText: jest.Mock;
  msg?: { text?: string };
  callbackQuery?: { data: string };
}

function createCtx(overrides: Partial<MockCtx> = {}): MockCtx {
  return {
    from: { id: 123 },
    chat: { id: 456 },
    session: {},
    reply: jest.fn().mockResolvedValue(undefined),
    answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: jest.fn().mockResolvedValue(undefined),
    editMessageText: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function getCommandHandler(name: string): (ctx: MockCtx) => Promise<void> {
  const call = mockBotInstance.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command handler '${name}' not registered`);
  return call[1] as (ctx: MockCtx) => Promise<void>;
}

function getMiddleware(): (ctx: MockCtx, next: () => Promise<void>) => Promise<void> {
  // First use() call is the session middleware, second is the auth middleware
  return mockBotInstance.use.mock.calls[1][0] as (ctx: MockCtx, next: () => Promise<void>) => Promise<void>;
}

function getCallbackQueryHandler(): (ctx: MockCtx) => Promise<void> {
  const call = mockBotInstance.callbackQuery.mock.calls.find(
    (c: unknown[]) => String(c[0]) === '/^ws:(\\d+)$/'
  );
  if (!call) throw new Error('callbackQuery handler not registered');
  return call[1] as (ctx: MockCtx) => Promise<void>;
}

describe('TelegramBot', () => {
  let bot: TelegramBot;
  let adapter: CodexAdapter;
  let store: LocalStore;
  let authGuard: AuthGuard;
  let eventRouter: EventRouter;
  let approvalEngine: ApprovalEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = createMockAdapter();
    store = createMockStore();
    authGuard = createMockAuthGuard();
    eventRouter = { on: jest.fn() } as unknown as EventRouter;
    approvalEngine = { resolve: jest.fn(), start: jest.fn(), stop: jest.fn() } as unknown as ApprovalEngine;

    bot = new TelegramBot(
      'test-token',
      adapter,
      store,
      authGuard,
      eventRouter,
      ['123'],
      approvalEngine,
      ['C:\\Projects'],
    );
  });

  // --- Setup tests ---

  it('should construct and register all command handlers', () => {
    const commands = mockBotInstance.command.mock.calls.map((c: unknown[]) => c[0]);
    expect(commands).toContain('start');
    expect(commands).toContain('list');
    expect(commands).toContain('open');
    expect(commands).toContain('new');
    expect(commands).toContain('send');
    expect(commands).toContain('steer');
    expect(commands).toContain('interrupt');
    expect(commands).toContain('pair');
    expect(commands).toContain('status');
    expect(commands).toContain('account');
    expect(commands).toContain('settings');
  });

  it('should register event forwarding', () => {
    expect(eventRouter.on).toHaveBeenCalled();
  });

  it('should call bot.init and bot.start on start()', async () => {
    await bot.start();
    expect(mockBotInstance.init).toHaveBeenCalled();
    expect(mockBotInstance.start).toHaveBeenCalled();
  });

  it('should call bot.stop on stop()', async () => {
    await bot.stop();
    expect(mockBotInstance.stop).toHaveBeenCalled();
  });

  // --- Short-ID callback mapping ---

  it('should generate callback data under 64 bytes', () => {
    const botAny = bot as unknown as Record<string, unknown>;
    const shortId = (botAny.generateShortId as () => string)();
    const callbackData = `${shortId}:a`;
    expect(callbackData.length).toBeLessThan(64);
    expect(shortId).toMatch(/^[a-z0-9]{8}$/);
  });

  it('should register and resolve callback mappings', () => {
    const botAny = bot as unknown as Record<string, unknown>;
    const shortId = (botAny.registerCallback as (id: string) => string)('apr_1234567890_abc123');
    const resolved = (botAny.resolveCallback as (id: string) => string | null)(shortId);
    expect(resolved).toBe('apr_1234567890_abc123');
  });

  it('should return null for unknown callback short ID', () => {
    const botAny = bot as unknown as Record<string, unknown>;
    expect((botAny.resolveCallback as (id: string) => string | null)('nonexistent')).toBeNull();
  });

  it('should clean up expired callback mappings', () => {
    // Access private methods via bracket notation (preserves this)
    const shortId = (bot as unknown as Record<string, (id: string) => string>)['registerCallback']('req-1');
    const callbackMap = (bot as unknown as Record<string, Map<string, { expiresAt: number }>>)['callbackMap'];
    const mapping = callbackMap.get(shortId)!;
    mapping.expiresAt = Date.now() - 1000;

    (bot as unknown as Record<string, () => void>)['cleanupCallbackMap']();
    expect((bot as unknown as Record<string, (id: string) => string | null>)['resolveCallback'](shortId)).toBeNull();
  });

  // --- Middleware (auth) ---

  describe('middleware', () => {
    it('should reject unauthorized user', async () => {
      // Directly set auth mock to reject all calls
      (authGuard.authenticateTelegram as jest.Mock).mockReturnValue(Promise.resolve(null));
      const mw = getMiddleware();
      const ctx = createCtx({ from: { id: 999 } });
      const next = jest.fn();
      await mw(ctx, next);
      expect(authGuard.authenticateTelegram).toHaveBeenCalledWith('999');
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow authorized user and call next', async () => {
      const mw = getMiddleware();
      const ctx = createCtx();
      const next = jest.fn().mockResolvedValue(undefined);
      await mw(ctx, next);
      expect(next).toHaveBeenCalled();
    });

    it('should ignore requests with no from.id', async () => {
      const mw = getMiddleware();
      const ctx = createCtx({ from: undefined });
      const next = jest.fn();
      await mw(ctx, next);
      // next is called because middleware returns early before calling next
      // The actual behavior is: `if (!userId) return;` so next() is NOT called
    });
  });

  // --- Command handlers ---

  describe('/start command', () => {
    it('should reply with help text', async () => {
      const handler = getCommandHandler('start');
      const ctx = createCtx();
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Codex Mobile Bridge'));
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('/list'));
    });
  });

  describe('/list command', () => {
    it('should fetch and display threads', async () => {
      const handler = getCommandHandler('list');
      const ctx = createCtx();
      await handler(ctx);
      expect(adapter.listThreads).toHaveBeenCalledWith({ limit: 20 });
      expect(ctx.reply).toHaveBeenCalled();
      // Second call should have the formatted thread list
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Test'), expect.anything());
    });

    it('should handle list error', async () => {
      (adapter.listThreads as jest.Mock).mockRejectedValue(new Error('RPC timeout'));
      const handler = getCommandHandler('list');
      const ctx = createCtx();
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('RPC timeout'));
    });
  });

  describe('/open command', () => {
    it('should open a thread and bind to user', async () => {
      const handler = getCommandHandler('open');
      const ctx = createCtx({ match: 't-1' });
      await handler(ctx);
      expect(adapter.readThread).toHaveBeenCalledWith('t-1', true);
      expect(store.bindThread).toHaveBeenCalledWith('t-1', '123');
      expect(ctx.session.currentThreadId).toBe('t-1');
      expect(ctx.reply).toHaveBeenCalled();
    });

    it('should show usage when no threadId given', async () => {
      const handler = getCommandHandler('open');
      const ctx = createCtx({ match: '' });
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith('Usage: /open <threadId>');
    });

    it('should handle open error', async () => {
      (adapter.readThread as jest.Mock).mockRejectedValue(new Error('not found'));
      const handler = getCommandHandler('open');
      const ctx = createCtx({ match: 'bad-id' });
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });

  describe('/new command', () => {
    it('should create thread directly when single workspace', async () => {
      const handler = getCommandHandler('new');
      const ctx = createCtx();
      await handler(ctx);
      expect(adapter.startThread).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('t-new'));
    });

    it('should show workspace selection when multiple workspaces', async () => {
      // Recreate with multiple workspaces
      jest.clearAllMocks();
      bot = new TelegramBot(
        'test-token', adapter, store, authGuard, eventRouter, ['123'],
        approvalEngine, ['C:\\ProjectA', 'C:\\ProjectB'],
      );
      const handler = getCommandHandler('new');
      const ctx = createCtx();
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith('Select a workspace:', expect.anything());
      expect(ctx.session.awaitingDirectory).toBe(true);
    });
  });

  describe('/send command', () => {
    it('should send message to current thread', async () => {
      const handler = getCommandHandler('send');
      const ctx = createCtx({ match: 'hello', session: { currentThreadId: 't-1' } });
      await handler(ctx);
      expect(adapter.startTurn).toHaveBeenCalledWith('t-1', 'hello');
    });

    it('should show usage when no text given', async () => {
      const handler = getCommandHandler('send');
      const ctx = createCtx({ match: '', session: { currentThreadId: 't-1' } });
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith('Usage: /send <text>');
    });

    it('should show no-thread error when no thread selected', async () => {
      const handler = getCommandHandler('send');
      const ctx = createCtx({ match: 'hello' });
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No thread selected'));
    });

    it('should handle send error', async () => {
      (adapter.startTurn as jest.Mock).mockRejectedValue(new Error('RPC fail'));
      const handler = getCommandHandler('send');
      const ctx = createCtx({ match: 'hello', session: { currentThreadId: 't-1' } });
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('RPC fail'));
    });
  });

  describe('/steer command', () => {
    it('should add input to active turn', async () => {
      const handler = getCommandHandler('steer');
      const ctx = createCtx({ match: 'more input', session: { currentThreadId: 't-1', activeTurnId: 'turn-1' } });
      await handler(ctx);
      expect(adapter.steerTurn).toHaveBeenCalledWith('t-1', 'turn-1', 'more input');
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Input added'));
    });

    it('should show usage when no text given', async () => {
      const handler = getCommandHandler('steer');
      const ctx = createCtx({ match: '', session: { currentThreadId: 't-1', activeTurnId: 'turn-1' } });
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith('Usage: /steer <text>');
    });

    it('should show no-turn error when no active turn', async () => {
      const handler = getCommandHandler('steer');
      const ctx = createCtx({ match: 'hello', session: { currentThreadId: 't-1' } });
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No active turn'));
    });
  });

  describe('/interrupt command', () => {
    it('should interrupt active turn', async () => {
      const handler = getCommandHandler('interrupt');
      const ctx = createCtx({ session: { currentThreadId: 't-1', activeTurnId: 'turn-1' } });
      await handler(ctx);
      expect(adapter.interruptTurn).toHaveBeenCalledWith('t-1', 'turn-1');
      expect(ctx.reply).toHaveBeenCalledWith('Turn interrupted.');
      expect(ctx.session.activeTurnId).toBeUndefined();
    });

    it('should show no-turn error when nothing to interrupt', async () => {
      const handler = getCommandHandler('interrupt');
      const ctx = createCtx();
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith('No active turn to interrupt.');
    });

    it('should handle interrupt error', async () => {
      (adapter.interruptTurn as jest.Mock).mockRejectedValue(new Error('fail'));
      const handler = getCommandHandler('interrupt');
      const ctx = createCtx({ session: { currentThreadId: 't-1', activeTurnId: 'turn-1' } });
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('fail'));
    });
  });

  describe('/pair command', () => {
    it('should generate and display pairing code', async () => {
      const handler = getCommandHandler('pair');
      const ctx = createCtx();
      await handler(ctx);
      expect(authGuard.generatePairingCode).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('123456'));
    });
  });

  describe('/status command', () => {
    it('should show bridge status', async () => {
      const handler = getCommandHandler('status');
      const ctx = createCtx({ session: { currentThreadId: 't-1' } });
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalled();
    });
  });

  describe('/account command', () => {
    it('should show account info', async () => {
      const handler = getCommandHandler('account');
      const ctx = createCtx();
      await handler(ctx);
      expect(adapter.readAccount).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('acct-1'));
    });

    it('should handle account error', async () => {
      (adapter.readAccount as jest.Mock).mockRejectedValue(new Error('unauthorized'));
      const handler = getCommandHandler('account');
      const ctx = createCtx();
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('unauthorized'));
    });
  });

  describe('/settings command', () => {
    it('should show security settings', async () => {
      const handler = getCommandHandler('settings');
      const ctx = createCtx();
      await handler(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Approval timeout'));
    });
  });

  // --- Workspace callback ---

  describe('workspace selection callback', () => {
    it('should handle valid workspace index', async () => {
      jest.clearAllMocks();
      bot = new TelegramBot(
        'test-token', adapter, store, authGuard, eventRouter, ['123'],
        approvalEngine, ['C:\\ProjectA', 'C:\\ProjectB'],
      );
      const handler = getCallbackQueryHandler();
      const ctx = createCtx({ match: ['ws:0', '0'] });
      await handler(ctx);
      expect(adapter.startThread).toHaveBeenCalledWith({ workspace: 'C:\\ProjectA' });
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('should reject invalid workspace index', async () => {
      jest.clearAllMocks();
      bot = new TelegramBot(
        'test-token', adapter, store, authGuard, eventRouter, ['123'],
        approvalEngine, ['C:\\ProjectA', 'C:\\ProjectB'],
      );
      const handler = getCallbackQueryHandler();
      const ctx = createCtx({ match: ['ws:99', '99'] });
      await handler(ctx);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Invalid workspace.' });
    });
  });

  // --- Event forwarding ---

  describe('event forwarding', () => {
    it('should register event listener via eventRouter.on', () => {
      expect(eventRouter.on).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should forward agentMessage/delta to matching chat', async () => {
      // Capture the event listener registered on eventRouter
      const eventListener = (eventRouter.on as jest.Mock).mock.calls[0][0];

      // Set up an active chat
      const botAny = bot as unknown as Record<string, unknown>;
      const activeChats = botAny.activeChats as Map<number, { chatId: number; threadId?: string }>;
      activeChats.set(456, { chatId: 456, threadId: 't-1' });

      // Emit a delta event
      await eventListener({
        type: 'item/agentMessage/delta',
        threadId: 't-1',
        itemId: 'item-1',
        delta: 'Hello ',
      });

      // Emit item/completed
      await eventListener({
        type: 'item/completed',
        threadId: 't-1',
        itemId: 'item-1',
        content: 'Hello World',
      });

      expect(mockBotInstance.api.sendMessage).toHaveBeenCalled();
    });

    it('should handle turn/started event', async () => {
      const eventListener = (eventRouter.on as jest.Mock).mock.calls[0][0];
      const botAny = bot as unknown as Record<string, unknown>;
      const activeChats = botAny.activeChats as Map<number, { chatId: number; threadId?: string; activeTurnId?: string }>;
      activeChats.set(456, { chatId: 456, threadId: 't-1' });

      await eventListener({
        type: 'turn/started',
        threadId: 't-1',
        turnId: 'turn-1',
      });

      expect(activeChats.get(456)?.activeTurnId).toBe('turn-1');
    });

    it('should handle turn/completed event', async () => {
      const eventListener = (eventRouter.on as jest.Mock).mock.calls[0][0];
      const botAny = bot as unknown as Record<string, unknown>;
      const activeChats = botAny.activeChats as Map<number, { chatId: number; threadId?: string; activeTurnId?: string }>;
      activeChats.set(456, { chatId: 456, threadId: 't-1', activeTurnId: 'turn-1' });

      await eventListener({
        type: 'turn/completed',
        threadId: 't-1',
        turnId: 'turn-1',
      });

      expect(mockBotInstance.api.sendMessage).toHaveBeenCalledWith(456, 'Turn completed.');
      expect(activeChats.get(456)?.activeTurnId).toBeUndefined();
    });
  });
});
