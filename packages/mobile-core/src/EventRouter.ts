export interface CodexEvent {
  type: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  delta?: string;
  content?: unknown;
  status?: string;
}

export interface StoredEvent extends CodexEvent {
  eventId: number;
  timestamp: number;
}

export type EventListener = (event: CodexEvent) => void;

export class EventRouter {
  private globalListeners: Set<EventListener> = new Set();
  private threadListeners: Map<string, Set<EventListener>> = new Map();
  private threadEvents: Map<string, StoredEvent[]> = new Map();
  private completedItems: Map<string, Set<string>> = new Map(); // threadId -> Set<itemId>
  private nextEventId = 1;
  private maxEventsPerThread = 5000;

  // --- Subscribe ---

  on(listener: EventListener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  onThread(threadId: string, listener: EventListener): () => void {
    if (!this.threadListeners.has(threadId)) {
      this.threadListeners.set(threadId, new Set());
    }
    this.threadListeners.get(threadId)!.add(listener);
    return () => {
      const listeners = this.threadListeners.get(threadId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) this.threadListeners.delete(threadId);
      }
    };
  }

  // --- Emit ---

  emit(event: CodexEvent): void {
    // Deduplicate item/completed by threadId + itemId
    if (event.type === 'item/completed' && event.threadId && event.itemId) {
      let seen = this.completedItems.get(event.threadId);
      if (!seen) {
        seen = new Set();
        this.completedItems.set(event.threadId, seen);
      }
      if (seen.has(event.itemId)) return; // already emitted
      seen.add(event.itemId);
    }

    const stored: StoredEvent = {
      ...event,
      eventId: this.nextEventId++,
      timestamp: Date.now(),
    };

    // Store per thread
    if (event.threadId) {
      let events = this.threadEvents.get(event.threadId);
      if (!events) {
        events = [];
        this.threadEvents.set(event.threadId, events);
      }
      events.push(stored);
      if (events.length > this.maxEventsPerThread) {
        events.splice(0, events.length - this.maxEventsPerThread);
      }
    }

    // Notify global listeners
    for (const listener of this.globalListeners) {
      try { listener(event); } catch (err) { console.error('EventRouter global listener error:', err); }
    }

    // Notify thread listeners
    if (event.threadId) {
      const listeners = this.threadListeners.get(event.threadId);
      if (listeners) {
        for (const listener of listeners) {
          try { listener(event); } catch (err) { console.error(`EventRouter thread listener error for ${event.threadId}:`, err); }
        }
      }
    }
  }

  // --- Retrieve ---

  getEvents(threadId: string, afterEventId = 0): StoredEvent[] {
    const events = this.threadEvents.get(threadId);
    if (!events) return [];
    return events.filter(e => e.eventId > afterEventId);
  }

  getLastEventId(threadId: string): number {
    const events = this.threadEvents.get(threadId);
    if (!events || events.length === 0) return 0;
    return events[events.length - 1].eventId;
  }

  // --- Backward compat (used by TelegramBot setupEventForwarding) ---

  onSession(sessionId: string, listener: EventListener): () => void {
    return this.onThread(sessionId, listener);
  }
}

// --- MessageAccumulator: merges deltas into complete content ---

export class MessageAccumulator {
  private buffer = new Map<string, string>();

  addDelta(itemId: string, delta: string): string {
    const current = this.buffer.get(itemId) || '';
    const updated = current + delta;
    this.buffer.set(itemId, updated);
    return updated;
  }

  get(itemId: string): string | undefined {
    return this.buffer.get(itemId);
  }

  complete(itemId: string): string | undefined {
    const content = this.buffer.get(itemId);
    this.buffer.delete(itemId);
    return content;
  }
}

// --- Message splitting for Telegram (4096 char limit) ---

const DEFAULT_MAX_CHUNK = 4000;

export function splitMessage(text: string, maxChunk = DEFAULT_MAX_CHUNK): string[] {
  if (text.length <= maxChunk) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunk) {
      chunks.push(remaining);
      break;
    }

    // Try to split at last newline within limit
    const newlineAt = remaining.lastIndexOf('\n', maxChunk);
    if (newlineAt > 0) {
      chunks.push(remaining.slice(0, newlineAt));
      remaining = remaining.slice(newlineAt + 1); // skip the newline
    } else {
      chunks.push(remaining.slice(0, maxChunk));
      remaining = remaining.slice(maxChunk);
    }
  }

  return chunks;
}
