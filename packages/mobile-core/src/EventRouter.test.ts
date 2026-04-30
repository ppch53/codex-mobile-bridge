import { EventRouter, MessageAccumulator, splitMessage, CodexEvent } from './EventRouter';

describe('EventRouter', () => {
  let router: EventRouter;

  beforeEach(() => {
    router = new EventRouter();
  });

  // --- Basic emit/listen ---

  describe('emit and listen', () => {
    it('should deliver events to global listeners', () => {
      const received: CodexEvent[] = [];
      router.on(e => received.push(e));

      router.emit({ type: 'test', threadId: 't1' });
      router.emit({ type: 'test2', threadId: 't2' });

      expect(received).toHaveLength(2);
      expect(received[0].type).toBe('test');
    });

    it('should deliver events to thread-specific listeners', () => {
      const received: CodexEvent[] = [];
      router.onThread('t1', e => received.push(e));

      router.emit({ type: 'a', threadId: 't1' });
      router.emit({ type: 'b', threadId: 't2' }); // different thread

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('a');
    });

    it('should unsubscribe correctly', () => {
      const fn = jest.fn();
      const unsub = router.on(fn);

      router.emit({ type: 'a' });
      unsub();
      router.emit({ type: 'b' });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should support onSession as alias for onThread', () => {
      const fn = jest.fn();
      router.onSession('t1', fn);

      router.emit({ type: 'a', threadId: 't1' });
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  // --- Event storage and offset ---

  describe('event storage', () => {
    it('should store events with auto-incrementing IDs', () => {
      router.emit({ type: 'a', threadId: 't1' });
      router.emit({ type: 'b', threadId: 't1' });
      router.emit({ type: 'c', threadId: 't2' });

      const t1Events = router.getEvents('t1');
      expect(t1Events).toHaveLength(2);
      expect(t1Events[0].eventId).toBe(1);
      expect(t1Events[1].eventId).toBe(2);

      const t2Events = router.getEvents('t2');
      expect(t2Events).toHaveLength(1);
      expect(t2Events[0].eventId).toBe(3);
    });

    it('should retrieve events after a given offset', () => {
      router.emit({ type: 'a', threadId: 't1' });
      router.emit({ type: 'b', threadId: 't1' });
      router.emit({ type: 'c', threadId: 't1' });

      const afterFirst = router.getEvents('t1', 1);
      expect(afterFirst).toHaveLength(2);
      expect(afterFirst[0].type).toBe('b');
    });

    it('should return empty array for unknown thread', () => {
      expect(router.getEvents('unknown')).toEqual([]);
    });

    it('should return last event ID for a thread', () => {
      router.emit({ type: 'a', threadId: 't1' });
      router.emit({ type: 'b', threadId: 't1' });

      expect(router.getLastEventId('t1')).toBe(2);
      expect(router.getLastEventId('unknown')).toBe(0);
    });
  });

  // --- item/completed dedup ---

  describe('item/completed dedup', () => {
    it('should deduplicate item/completed events by itemId', () => {
      const received: CodexEvent[] = [];
      router.on(e => received.push(e));

      router.emit({ type: 'item/completed', threadId: 't1', itemId: 'item-1', content: 'first' });
      router.emit({ type: 'item/completed', threadId: 't1', itemId: 'item-1', content: 'duplicate' });
      router.emit({ type: 'item/completed', threadId: 't1', itemId: 'item-2', content: 'different' });

      expect(received).toHaveLength(2);
      expect(received[0].content).toBe('first');
      expect(received[1].content).toBe('different');
    });

    it('should not deduplicate different event types', () => {
      const received: CodexEvent[] = [];
      router.on(e => received.push(e));

      router.emit({ type: 'item/started', threadId: 't1', itemId: 'item-1' });
      router.emit({ type: 'item/started', threadId: 't1', itemId: 'item-1' });

      expect(received).toHaveLength(2);
    });

    it('should not deduplicate across different threads', () => {
      const received: CodexEvent[] = [];
      router.on(e => received.push(e));

      router.emit({ type: 'item/completed', threadId: 't1', itemId: 'item-1' });
      router.emit({ type: 'item/completed', threadId: 't2', itemId: 'item-1' });

      expect(received).toHaveLength(2);
    });
  });

  // --- 1000-line stress test ---

  describe('stress', () => {
    it('should handle 1000 delta events without data loss', () => {
      const acc = new MessageAccumulator();
      const received: string[] = [];
      router.on(e => {
        if (e.type === 'item/agentMessage/delta' && e.delta && e.itemId) {
          acc.addDelta(e.itemId, e.delta);
        }
        if (e.type === 'item/completed' && e.itemId) {
          const content = acc.complete(e.itemId);
          if (content !== undefined) received.push(content);
        }
      });

      const itemId = 'output-1';
      let expected = '';
      for (let i = 0; i < 1000; i++) {
        const delta = `Line ${i}\n`;
        expected += delta;
        router.emit({ type: 'item/agentMessage/delta', threadId: 't1', itemId, delta });
      }
      router.emit({ type: 'item/completed', threadId: 't1', itemId });

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(expected);
      expect(received[0].split('\n')).toHaveLength(1001); // 1000 lines + trailing newline
    });

    it('should cap stored events per thread', () => {
      // Emit more than maxEventsPerThread (5000) events
      for (let i = 0; i < 5100; i++) {
        router.emit({ type: 'ping', threadId: 't1' });
      }
      const events = router.getEvents('t1');
      expect(events.length).toBeLessThanOrEqual(5000);
      // Oldest events should be trimmed
      expect(events[0].eventId).toBeGreaterThan(1);
    });
  });
});

describe('MessageAccumulator', () => {
  it('should accumulate deltas and return full content', () => {
    const acc = new MessageAccumulator();
    acc.addDelta('item-1', 'Hello ');
    acc.addDelta('item-1', 'World');
    expect(acc.get('item-1')).toBe('Hello World');
  });

  it('should return independent buffers per itemId', () => {
    const acc = new MessageAccumulator();
    acc.addDelta('a', 'aaa');
    acc.addDelta('b', 'bbb');
    expect(acc.get('a')).toBe('aaa');
    expect(acc.get('b')).toBe('bbb');
  });

  it('should return and delete buffer on complete', () => {
    const acc = new MessageAccumulator();
    acc.addDelta('item-1', 'content');
    const result = acc.complete('item-1');
    expect(result).toBe('content');
    expect(acc.get('item-1')).toBeUndefined();
  });
});

describe('splitMessage', () => {
  it('should not split short messages', () => {
    expect(splitMessage('hello')).toEqual(['hello']);
  });

  it('should split at newlines within limit', () => {
    const text = 'aaa\nbbb\nccc';
    const chunks = splitMessage(text, 5);
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should be <= 5 chars
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
    }
    // Reassembling should give original text
    expect(chunks.join('\n')).toBe(text);
  });

  it('should hard-split if no newline within limit', () => {
    const text = 'a'.repeat(100);
    const chunks = splitMessage(text, 30);
    expect(chunks.length).toBe(4); // 30+30+30+10
    expect(chunks.join('')).toBe(text);
  });

  it('should handle large messages', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
    const text = lines.join('\n');
    const chunks = splitMessage(text, 4000);

    // Verify all chunks are within limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
    // Verify reassembled content matches (chunks are joined with the removed newline)
    const reassembled = chunks.join('\n');
    expect(reassembled).toBe(text);
  });
});
