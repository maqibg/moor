import type { MoorEventType, MoorEventData } from "@moor/types";

type EventHandler<T extends MoorEventType = MoorEventType> = (
  event: T,
  data: MoorEventData<T>,
) => void;

type AnyHandler = EventHandler<MoorEventType>;

class EventBus {
  private handlers: Map<string, Set<AnyHandler>> = new Map();

  on<T extends MoorEventType>(event: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as unknown as AnyHandler);
    return () => {
      this.handlers.get(event)?.delete(handler as unknown as AnyHandler);
    };
  }

  emit<T extends MoorEventType>(event: T, data: MoorEventData<T>) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as unknown as EventHandler<T>)(event, data);
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
