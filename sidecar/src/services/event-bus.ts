type EventHandler = (event: string, data: unknown) => void;

class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, data?: unknown) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event, data);
        } catch (err) {
          console.error(`EventBus handler error for ${event}:`, err);
        }
      }
    }
  }

  removeAll() {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();
