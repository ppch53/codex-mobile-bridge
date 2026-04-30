import { Bot, Context, session, SessionFlavor } from 'grammy';
import { CodexAdapter } from '@codex-mobile-bridge/codex-adapter';
import { LocalStore } from '@codex-mobile-bridge/store';
import { AuthGuard, PolicyEngine, Redactor } from '@codex-mobile-bridge/security';
import { EventRouter, ApprovalEngine, ThreadPresenter, CodexEvent, MessageAccumulator, splitMessage } from '@codex-mobile-bridge/mobile-core';

interface SessionData {
  currentThreadId?: string;
  activeTurnId?: string;
  awaitingDirectory?: boolean;
  awaitingSecondConfirmation?: string;
  lastMenuMessageId?: number;
}

type MyContext = Context & SessionFlavor<SessionData>;

interface ActiveChat {
  chatId: number;
  threadId?: string;
  activeTurnId?: string;
}

interface CallbackMapping {
  requestId: string;
  expiresAt: number;
}

const SHORT_ID_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class TelegramBot {
  private bot: Bot<MyContext>;
  private activeChats: Map<number, ActiveChat> = new Map();
  private accumulators: Map<string, MessageAccumulator> = new Map();
  private sentMessages: Map<string, number> = new Map();
  private callbackMap: Map<string, CallbackMapping> = new Map();
  private callbackCleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private token: string,
    private adapter: CodexAdapter,
    private store: LocalStore,
    private authGuard: AuthGuard,
    private eventRouter: EventRouter,
    private allowedUserIds: string[],
    private approvalEngine: ApprovalEngine,
    private allowedWorkspaces: string[],
    private policyEngine?: PolicyEngine,
    private redactor?: Redactor
  ) {
    this.bot = new Bot<MyContext>(token);
    this.bot.use(session({ initial: () => ({}) }));
    this.setupHandlers();
    this.setupEventForwarding();

    // Periodically clean up expired callback mappings
    this.callbackCleanupInterval = setInterval(() => this.cleanupCallbackMap(), 60_000);
    this.callbackCleanupInterval.unref?.();
  }

  // --- Short-ID callback mapping ---

  private generateShortId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  private registerCallback(requestId: string): string {
    const shortId = this.generateShortId();
    this.callbackMap.set(shortId, { requestId, expiresAt: Date.now() + SHORT_ID_TTL_MS });
    return shortId;
  }

  private resolveCallback(shortId: string): string | null {
    const mapping = this.callbackMap.get(shortId);
    if (!mapping) return null;
    if (Date.now() > mapping.expiresAt) {
      this.callbackMap.delete(shortId);
      return null;
    }
    return mapping.requestId;
  }

  private cleanupCallbackMap(): void {
    const now = Date.now();
    for (const [key, mapping] of this.callbackMap.entries()) {
      if (now > mapping.expiresAt) {
        this.callbackMap.delete(key);
      }
    }
  }

  // --- Event forwarding ---

  private setupEventForwarding(): void {
    this.eventRouter.on(async (event: CodexEvent) => {
      for (const [chatId, active] of this.activeChats.entries()) {
        if (!active.threadId || event.threadId !== active.threadId) continue;

        try {
          if (event.type === 'item/agentMessage/delta' && event.delta && event.itemId) {
            let acc = this.accumulators.get(event.itemId);
            if (!acc) {
              acc = new MessageAccumulator();
              this.accumulators.set(event.itemId, acc);
            }
            acc.addDelta(event.itemId, event.delta);
          }

          if (event.type === 'item/completed' && event.itemId) {
            const acc = this.accumulators.get(event.itemId);
            if (acc) {
              const content = acc.complete(event.itemId);
              this.accumulators.delete(event.itemId);
              if (content) {
                let text = content;
                if (this.redactor) {
                  text = this.redactor.redact(text).text;
                }
                const chunks = splitMessage(text);
                for (const chunk of chunks) {
                  await this.bot.api.sendMessage(chatId, chunk);
                }
              }
            }
          }

          if (event.type === 'turn/completed') {
            await this.bot.api.sendMessage(chatId, 'Turn completed.');
            active.activeTurnId = undefined;
          }

          if (event.type === 'turn/started' && event.turnId) {
            active.activeTurnId = event.turnId;
          }
        } catch (err) {
          console.error(`Event forwarding error for chat ${chatId}:`, err);
        }
      }
    });
  }

  // --- Command handlers ---

  private setupHandlers(): void {
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id.toString();
      if (!userId) return;
      const auth = await this.authGuard.authenticateTelegram(userId);
      if (!auth) {
        await ctx.reply('Unauthorized. Please contact the administrator.');
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx as any).user = auth; // Grammy Context doesn't support custom properties via generics

      const chatId = ctx.chat?.id;
      if (chatId) {
        this.activeChats.set(chatId, this.activeChats.get(chatId) || { chatId });
      }

      return next();
    });

    this.bot.command('start', async (ctx) => {
      const helpText = `Codex Mobile Bridge

Commands:
/list - Show recent threads
/open <id> - Open a thread
/new - Create a new thread
/send <text> - Send a message to current thread
/steer <text> - Add input to active turn
/interrupt - Interrupt current turn
/pair - Generate pairing code for Web
/status - Show bridge status
/account - Show Codex account info
/settings - Show current security settings`;
      await ctx.reply(helpText);
    });

    this.bot.command('list', async (ctx) => {
      await ctx.reply('Fetching threads...');
      try {
        const result = await this.adapter.listThreads({ limit: 20 });
        const formatted = ThreadPresenter.formatThreadList(result.items);
        await ctx.reply(formatted, { parse_mode: 'Markdown' });
      } catch (err) {
        await ctx.reply(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    this.bot.command('open', async (ctx) => {
      const threadId = ctx.match?.toString().trim();
      if (!threadId) {
        await ctx.reply('Usage: /open <threadId>');
        return;
      }

      try {
        const thread = await this.adapter.readThread(threadId, true);
        ctx.session.currentThreadId = threadId;

        const chatId = ctx.chat?.id;
        if (chatId) {
          const active = this.activeChats.get(chatId) || { chatId };
          active.threadId = threadId;
          this.activeChats.set(chatId, active);
        }

        const userId = ctx.from?.id.toString();
        if (userId) {
          await this.store.bindThread(threadId, userId);
        }

        const formatted = ThreadPresenter.formatThreadDetail(thread);
        await ctx.reply(formatted, { parse_mode: 'Markdown' });
      } catch (err) {
        await ctx.reply(`Failed to open thread: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    this.bot.command('new', async (ctx) => {
      // If only one workspace, use it directly
      if (this.allowedWorkspaces.length <= 1) {
        const workspace = this.allowedWorkspaces[0];
        await this.createThread(ctx, workspace);
        return;
      }

      // Multiple workspaces: show selection keyboard
      ctx.session.awaitingDirectory = true;
      const keyboard = this.allowedWorkspaces.map((ws, idx) => [{
        text: ws,
        callback_data: `ws:${idx}`,
      }]);
      await ctx.reply('Select a workspace:', {
        reply_markup: { inline_keyboard: keyboard },
      });
    });

    // Handle workspace selection callback
    this.bot.callbackQuery(/^ws:(\d+)$/, async (ctx) => {
      const idx = parseInt(ctx.match[1], 10);
      if (idx < 0 || idx >= this.allowedWorkspaces.length) {
        await ctx.answerCallbackQuery({ text: 'Invalid workspace.' });
        return;
      }
      ctx.session.awaitingDirectory = false;
      await ctx.answerCallbackQuery();
      const workspace = this.allowedWorkspaces[idx];
      await this.createThread(ctx, workspace);
    });

    this.bot.command('send', async (ctx) => {
      const text = ctx.match?.toString().trim();
      if (!text) {
        await ctx.reply('Usage: /send <text>');
        return;
      }

      const threadId = ctx.session.currentThreadId;
      if (!threadId) {
        await ctx.reply('No thread selected. Use /list and /open first, or /new to create one.');
        return;
      }

      try {
        const turn = await this.adapter.startTurn(threadId, text);
        ctx.session.activeTurnId = turn.id;

        const chatId = ctx.chat?.id;
        if (chatId) {
          const active = this.activeChats.get(chatId);
          if (active) active.activeTurnId = turn.id;
        }

        await ctx.reply(`Message sent. Turn: ${turn.id}`);
      } catch (err) {
        await ctx.reply(`Failed to send: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    this.bot.command('steer', async (ctx) => {
      const text = ctx.match?.toString().trim();
      if (!text) {
        await ctx.reply('Usage: /steer <text>');
        return;
      }

      const threadId = ctx.session.currentThreadId;
      const turnId = ctx.session.activeTurnId;
      if (!threadId || !turnId) {
        await ctx.reply('No active turn. Use /send first.');
        return;
      }

      try {
        await this.adapter.steerTurn(threadId, turnId, text);
        await ctx.reply('Input added to active turn.');
      } catch (err) {
        await ctx.reply(`Failed to steer: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    this.bot.command('interrupt', async (ctx) => {
      const threadId = ctx.session.currentThreadId;
      const turnId = ctx.session.activeTurnId;
      if (!threadId || !turnId) {
        await ctx.reply('No active turn to interrupt.');
        return;
      }

      try {
        await this.adapter.interruptTurn(threadId, turnId);
        ctx.session.activeTurnId = undefined;
        await ctx.reply('Turn interrupted.');
      } catch (err) {
        await ctx.reply(`Failed to interrupt: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    this.bot.command('pair', async (ctx) => {
      try {
        const { deviceId, code } = await this.authGuard.generatePairingCode();
        await ctx.reply(
          `Web Pairing Code: ${code}\n\n` +
          `Open the Web UI and enter this code. Expires in 10 minutes.\n` +
          `Device ID: ${deviceId.slice(0, 8)}...`
        );
      } catch (err) {
        await ctx.reply(`Failed to generate pairing code: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    this.bot.command('status', async (ctx) => {
      const status = {
        codexConnected: true,
        telegramConnected: true,
        webEnabled: true,
        currentThreadId: ctx.session.currentThreadId,
      };
      const formatted = ThreadPresenter.formatStatus(status);
      await ctx.reply(formatted, { parse_mode: 'Markdown' });
    });

    this.bot.command('account', async (ctx) => {
      try {
        const account = await this.adapter.readAccount();
        let text = `Account: ${account.id}`;
        if (account.name) text += `\nName: ${account.name}`;
        if (account.plan) text += `\nPlan: ${account.plan}`;
        if (this.redactor) {
          text = this.redactor.redact(text).text;
        }
        await ctx.reply(text);
      } catch (err) {
        await ctx.reply(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    this.bot.command('settings', async (ctx) => {
      const settings = [
        `Approval timeout: 300s`,
        `Dangerous command confirm: ${this.policyEngine ? 'enabled' : 'disabled'}`,
        `Redact secrets: ${this.redactor ? 'enabled' : 'disabled'}`,
      ];
      await ctx.reply(settings.join('\n'));
    });

    // Handle callback queries for approval buttons (using short IDs)
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      const parts = data.split(':');
      if (parts.length !== 2) {
        await ctx.answerCallbackQuery({ text: 'Invalid action.' });
        return;
      }

      const [shortId, decision] = parts;
      const requestId = this.resolveCallback(shortId);
      if (!requestId) {
        await ctx.answerCallbackQuery({ text: 'Request not found or expired.' });
        return;
      }

      const approved = decision === 'a';

      try {
        const pending = await this.store.getPendingRequest(requestId);
        if (!pending) {
          await ctx.answerCallbackQuery({ text: 'Request not found or expired.' });
          return;
        }

        if (pending.resolved) {
          await ctx.answerCallbackQuery({ text: 'Already resolved.' });
          return;
        }

        // Check if dangerous command needs second confirmation
        if (approved && this.policyEngine && pending.type === 'item/commandExecution/requestApproval') {
          const command = (pending.data as Record<string, unknown>)?.command;
          if (command) {
            const policy = this.policyEngine.evaluateCommand(command as string);
            if (policy.requiresSecondConfirmation && ctx.session.awaitingSecondConfirmation !== requestId) {
              ctx.session.awaitingSecondConfirmation = requestId;
              // Register short IDs for the confirmation buttons
              const confirmShortId = this.registerCallback(requestId);
              const cancelShortId = this.registerCallback(requestId);
              await ctx.answerCallbackQuery({ text: 'Dangerous command - confirm again.' });
              await ctx.reply(
                `DANGEROUS COMMAND: \`${command}\`\n\nAre you sure? This action cannot be undone.`,
                {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: 'Confirm', callback_data: `${confirmShortId}:a` },
                        { text: 'Cancel', callback_data: `${cancelShortId}:r` },
                      ],
                    ],
                  },
                }
              );
              return;
            }
          }
        }

        ctx.session.awaitingSecondConfirmation = undefined;
        await this.approvalEngine.resolve(requestId, approved);

        const userId = ctx.from?.id.toString() || 'unknown';
        await this.store.addAuditLog(
          userId,
          `approval.${approved ? 'approve' : 'reject'}`,
          'request',
          requestId,
          approved ? 'approved' : 'rejected'
        );

        await ctx.answerCallbackQuery({
          text: approved ? 'Approved.' : 'Rejected.',
        });

        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        const label = approved ? 'Approved' : 'Rejected';
        await ctx.editMessageText(
          `${ctx.msg?.text || 'Approval request'}\n\n--- ${label} ---`
        );
      } catch (err) {
        await ctx.answerCallbackQuery({ text: 'Error processing request.' });
      }
    });
  }

  private async createThread(ctx: MyContext, workspace?: string): Promise<void> {
    try {
      const thread = await this.adapter.startThread(workspace ? { workspace } : undefined);
      ctx.session.currentThreadId = thread.id;

      const chatId = ctx.chat?.id;
      if (chatId) {
        const active = this.activeChats.get(chatId) || { chatId };
        active.threadId = thread.id;
        this.activeChats.set(chatId, active);
      }

      const userId = ctx.from?.id.toString();
      if (userId) {
        await this.store.bindThread(thread.id, userId);
      }

      await ctx.reply(`New thread created: ${thread.id}${workspace ? ` (${workspace})` : ''}`);
    } catch (err) {
      await ctx.reply(`Failed to create thread: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async start(): Promise<void> {
    await this.bot.init();
    this.bot.start();
    console.log('Telegram bot started');
  }

  async stop(): Promise<void> {
    if (this.callbackCleanupInterval) {
      clearInterval(this.callbackCleanupInterval);
      this.callbackCleanupInterval = null;
    }
    this.bot.stop();
  }
}
