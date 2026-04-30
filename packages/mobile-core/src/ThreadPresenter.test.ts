import { ThreadPresenter } from './ThreadPresenter';
import { ThreadSummary, ThreadDetail } from './types';

describe('ThreadPresenter', () => {
  describe('formatThreadList', () => {
    it('should format a list of threads', () => {
      const threads: ThreadSummary[] = [
        { id: 't1', title: 'First', status: 'active' },
        { id: 't2', title: 'Second', status: 'completed' },
      ];
      const result = ThreadPresenter.formatThreadList(threads);
      expect(result).toContain('t1');
      expect(result).toContain('First');
      expect(result).toContain('active');
      expect(result).toContain('t2');
    });

    it('should return empty message for empty list', () => {
      expect(ThreadPresenter.formatThreadList([])).toBe('No threads found.');
    });

    it('should use "Untitled" when title is missing', () => {
      const threads: ThreadSummary[] = [{ id: 't1', status: 'active' }];
      const result = ThreadPresenter.formatThreadList(threads);
      expect(result).toContain('Untitled');
    });
  });

  describe('formatThreadDetail', () => {
    it('should format thread with basic fields', () => {
      const thread: ThreadDetail = { id: 't1', title: 'Test', status: 'active' };
      const result = ThreadPresenter.formatThreadDetail(thread);
      expect(result).toContain('t1');
      expect(result).toContain('Test');
      expect(result).toContain('active');
    });

    it('should show turn count when turns present', () => {
      const thread: ThreadDetail = {
        id: 't1',
        title: 'Test',
        status: 'active',
        turns: [{ id: 'tu1' }, { id: 'tu2' }],
      };
      const result = ThreadPresenter.formatThreadDetail(thread);
      expect(result).toContain('Turns: 2');
    });

    it('should not show turns when empty or absent', () => {
      const thread: ThreadDetail = { id: 't1', title: 'Test', status: 'active' };
      const result = ThreadPresenter.formatThreadDetail(thread);
      expect(result).not.toContain('Turns');
    });
  });

  describe('formatStatus', () => {
    it('should format connected status', () => {
      const result = ThreadPresenter.formatStatus({
        codexConnected: true,
        telegramConnected: true,
        webEnabled: true,
      });
      expect(result).toContain('Codex');
      expect(result).toContain('Web');
    });
  });
});
