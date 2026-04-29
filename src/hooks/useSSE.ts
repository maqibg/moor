import { useEffect, useCallback, useRef } from "react";
import { getApiHeaders, getApiUrl } from "@/lib/api";

interface SSEEvent {
  type: string;
  data: unknown;
}

export function useSSE(onEvent: (event: SSEEvent) => void) {
  const abortRef = useRef<AbortController | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(async () => {
    if (abortRef.current) return;

    try {
      const url = await getApiUrl("/api/events");
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(url, {
        headers: await getApiHeaders({ Accept: "text/event-stream" }),
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
          onEventRef.current({ type: event, data: JSON.parse(dataLine.slice(6)) });
        }
      }

      abortRef.current = null;
      setTimeout(() => connect(), 5000);
    } catch (err) {
      abortRef.current = null;
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setTimeout(() => connect(), 5000);
      }
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [connect]);
}
