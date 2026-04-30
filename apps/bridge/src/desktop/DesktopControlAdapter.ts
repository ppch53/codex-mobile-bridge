import { execFile } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import { EventRouter } from '@codex-mobile-bridge/mobile-core';
import type { PaginatedResult, ThreadSummary, TurnSummary } from '@codex-mobile-bridge/codex-adapter';

interface ThreadRow {
  id: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  source: string;
  cwd: string;
  title: string;
  archived: number;
}

interface DesktopThread extends ThreadSummary {
  cwd: string;
  rolloutPath: string;
}

interface RolloutMessage {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    phase?: string;
    message?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function normalizeWindowsPath(value: string): string {
  return value.replace(/^\\\\\?\\/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function newestDesktopThread(stateDbPath: string): DesktopThread | null {
  if (!existsSync(stateDbPath)) return null;

  const db = new BetterSqlite3(stateDbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(`
      SELECT id, rollout_path, created_at, updated_at, source, cwd, title, archived
      FROM threads
      WHERE archived = 0 AND source = 'vscode'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get() as ThreadRow | undefined;

    if (!row || !existsSync(row.rollout_path)) return null;
    return {
      id: row.id,
      title: row.title || 'Current Codex Desktop session',
      status: 'desktop',
      createdAt: new Date(row.created_at * 1000).toISOString(),
      updatedAt: new Date(row.updated_at * 1000).toISOString(),
      cwd: normalizeWindowsPath(row.cwd),
      rolloutPath: row.rollout_path,
    };
  } finally {
    db.close();
  }
}

function extractAssistantText(line: string, startedAt: number): string | null {
  let parsed: RolloutMessage;
  try {
    parsed = JSON.parse(line) as RolloutMessage;
  } catch {
    return null;
  }

  if (!parsed.timestamp || Date.parse(parsed.timestamp) < startedAt) return null;
  const payload = parsed.payload;
  if (!payload) return null;

  if (payload.type === 'agent_message' && payload.phase === 'final' && payload.message) {
    return payload.message;
  }

  if (payload.type !== 'message' || payload.role !== 'assistant' || payload.phase !== 'final') {
    return null;
  }

  const chunks = payload.content
    ?.filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text as string) ?? [];
  return chunks.join('\n\n').trim() || null;
}

async function waitForFinalText(rolloutPath: string, startedAt: number, initialSize: number): Promise<string> {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let offset = initialSize;
  let lastText: string | null = null;

  while (Date.now() < deadline) {
    const size = statSync(rolloutPath).size;
    if (size > offset) {
      const appended = readFileSync(rolloutPath, 'utf8').slice(offset);
      offset = size;
      for (const line of appended.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const text = extractAssistantText(line, startedAt);
        if (text) lastText = text;
      }
      if (lastText) return lastText;
    }
    await sleep(500);
  }

  throw new Error(`Timed out waiting for Codex Desktop output in ${rolloutPath}`);
}

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 30_000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve();
      }
    );
  });
}

function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function pasteIntoCodexDesktop(text: string): Promise<void> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$proc = Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "Codex Desktop window not found" }
[System.Windows.Forms.Clipboard]::SetText(${psSingleQuoted(text)})
[NativeWin]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 350
$rect = New-Object NativeWin+RECT
[NativeWin]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
$x = [int](($rect.Left + $rect.Right) / 2)
$y = [int]($rect.Bottom - 72)
[NativeWin]::SetCursorPos($x, $y) | Out-Null
[NativeWin]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[NativeWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
`;
  await runPowerShell(script);
}

async function pressEscapeInCodexDesktop(): Promise<void> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$proc = Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "Codex Desktop window not found" }
[NativeWin]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
`;
  await runPowerShell(script);
}

export class DesktopControlAdapter {
  private activeTurns = new Map<string, string>();

  constructor(
    private readonly eventRouter: EventRouter,
    private readonly stateDbPath = path.join(homedir(), '.codex', 'state_5.sqlite')
  ) {}

  async listThreads(): Promise<PaginatedResult<ThreadSummary>> {
    const thread = newestDesktopThread(this.stateDbPath);
    return {
      items: thread
        ? [{
          id: thread.id,
          title: `${thread.title} (Codex Desktop)`,
          status: 'desktop',
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        }]
        : [],
    };
  }

  async startTurn(threadId: string, input: string): Promise<TurnSummary> {
    const thread = newestDesktopThread(this.stateDbPath);
    if (!thread) {
      throw new Error('No active Codex Desktop thread found. Open Codex Desktop first.');
    }
    if (thread.id !== threadId) {
      throw new Error('Only the latest active Codex Desktop thread can be controlled in desktop-control mode.');
    }

    const startedAt = Date.now();
    const initialSize = statSync(thread.rolloutPath).size;
    const turnId = `desktop-${startedAt}`;
    this.activeTurns.set(threadId, turnId);
    this.eventRouter.emit({ type: 'turn/started', threadId, turnId, status: 'active' });

    await pasteIntoCodexDesktop(input);

    void waitForFinalText(thread.rolloutPath, startedAt, initialSize)
      .then(text => {
        this.eventRouter.emit({
          type: 'item/completed',
          threadId,
          turnId,
          itemId: `${turnId}-final`,
          content: text,
          status: 'completed',
        });
        this.eventRouter.emit({ type: 'turn/completed', threadId, turnId, status: 'completed' });
      })
      .catch(error => {
        this.eventRouter.emit({
          type: 'item/completed',
          threadId,
          turnId,
          itemId: `${turnId}-error`,
          content: `Desktop control failed: ${error instanceof Error ? error.message : String(error)}`,
          status: 'failed',
        });
        this.eventRouter.emit({ type: 'turn/completed', threadId, turnId, status: 'failed' });
      })
      .finally(() => {
        if (this.activeTurns.get(threadId) === turnId) {
          this.activeTurns.delete(threadId);
        }
      });

    return {
      id: turnId,
      threadId,
      status: 'active',
      input,
      createdAt: new Date(startedAt).toISOString(),
    };
  }

  async interruptTurn(threadId: string): Promise<void> {
    if (!this.activeTurns.has(threadId)) return;
    await pressEscapeInCodexDesktop();
  }
}
