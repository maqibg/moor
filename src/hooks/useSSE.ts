import { useEffect, useCallback, useRef } from "react";
import { getApiUrl } from "@/lib/api";

interface SSEEvent {
  type: string;
  data: unknown;
}

export function useSSE(onEvent: (event: SSEEvent) => void) {
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(async () => {
    if (esRef.current) return;

    try {
      const url = await getApiUrl("/api/events");

      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("server:status", (e) => {
        onEventRef.current({ type: "server:status", data: JSON.parse(e.data) });
      });

      es.addEventListener("server:tools", (e) => {
        onEventRef.current({ type: "server:tools", data: JSON.parse(e.data) });
      });

      es.addEventListener("profile:activated", (e) => {
        onEventRef.current({ type: "profile:activated", data: JSON.parse(e.data) });
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setTimeout(() => connect(), 5000);
      };
    } catch {
      setTimeout(() => connect(), 5000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);
}
