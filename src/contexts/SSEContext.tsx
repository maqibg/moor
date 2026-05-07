import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from "react";
import { getApiRequest, resetRuntime } from "@/lib/api";
import type { MoorEvent, MoorEventType } from "@moor/types";

interface SSEContextValue {
  subscribe: (eventType: MoorEventType, handler: (data: unknown) => void) => () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

export function SSEProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef(new Map<MoorEventType, Set<(data: unknown) => void>>());

  useEffect(() => {
    const controller = new AbortController();
    const scheduleReconnect = () => {
      setTimeout(() => {
        if (!controller.signal.aborted) void connect();
      }, 5000);
    };

    async function connect() {
      try {
        const { url, headers } = await getApiRequest("/api/events", {
          Accept: "text/event-stream",
        });
        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`SSE failed: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const chunk of events) {
            const event = chunk
              .split("\n")
              .find((line) => line.startsWith("event: "))
              ?.slice(7);
            const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
            if (!event || !dataLine) continue;

            const data = JSON.parse(dataLine.slice(6));
            const typedEvent = { type: event, data } as MoorEvent;

            const handlers = handlersRef.current.get(typedEvent.type);
            if (handlers) {
              for (const handler of handlers) {
                handler(typedEvent.data);
              }
            }
          }
        }
        if (!controller.signal.aborted) scheduleReconnect();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        resetRuntime();
        scheduleReconnect();
      }
    }

    void connect();
    return () => controller.abort();
  }, []);

  const subscribe = useCallback((eventType: MoorEventType, handler: (data: unknown) => void) => {
    if (!handlersRef.current.has(eventType)) {
      handlersRef.current.set(eventType, new Set());
    }
    handlersRef.current.get(eventType)!.add(handler);
    return () => {
      handlersRef.current.get(eventType)?.delete(handler);
    };
  }, []);

  return <SSEContext.Provider value={{ subscribe }}>{children}</SSEContext.Provider>;
}

export function useSSEEvent(eventType: MoorEventType, handler: (data: unknown) => void) {
  const ctx = useContext(SSEContext);
  if (!ctx) throw new Error("useSSEEvent must be used within SSEProvider");

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return ctx.subscribe(eventType, (data) => handlerRef.current(data));
  }, [ctx, eventType]);
}
