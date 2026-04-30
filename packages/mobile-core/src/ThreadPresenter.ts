import { ThreadSummary, ThreadDetail } from './types';

export class ThreadPresenter {
  static formatThreadList(threads: ThreadSummary[]): string {
    if (!threads.length) return 'No threads found.';
    return threads.map(t => `- ${t.id}: ${t.title || 'Untitled'} (${t.status})`).join('\n');
  }

  static formatThreadDetail(thread: ThreadDetail): string {
    let result = `Thread: ${thread.id}\nTitle: ${thread.title || 'Untitled'}\nStatus: ${thread.status}`;
    if (thread.turns && thread.turns.length > 0) {
      result += `\nTurns: ${thread.turns.length}`;
    }
    return result;
  }

  static formatStatus(status: { codexConnected: boolean; telegramConnected: boolean; webEnabled: boolean; currentThreadId?: string }): string {
    return `Status: Codex ${status.codexConnected ? '✓' : '✗'} | Web ${status.webEnabled ? '✓' : '✗'}\nCurrent thread: ${status.currentThreadId || 'none'}`;
  }
}
