import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getApiRuntime, buildApiUrl, buildApiHeaders, resetRuntime } from "@/lib/api/runtime";
import { logKeys, profileKeys, serverKeys, settingKeys } from "@/lib/query-keys";
import { mergeServerStatusEvent } from "@/hooks/server-patch-utils";
import type {
  MoorEvent,
  MoorEventData,
  MoorEventType,
  Server,
  ServerDetail,
  ServerStatus,
} from "@moor/types";

interface SSEContextValue {
  subscribe: <T extends MoorEventType>(
    eventType: T,
    handler: (data: MoorEventData<T>) => void,
  ) => () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

type WarnFn = (message: string) => void;
const serverStatuses = new Set<ServerStatus>(["stopped", "starting", "running", "error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidEvent(event: string, warn: WarnFn): null {
  warn(`Dropped invalid SSE payload for ${event}`);
  return null;
}

function isServerStatusEvent(data: unknown): data is MoorEventData<"server:status"> {
  return (
    isRecord(data) &&
    typeof data.serverId === "string" &&
    typeof data.status === "string" &&
    serverStatuses.has(data.status as ServerStatus) &&
    (data.errorMessage === undefined ||
      data.errorMessage === null ||
      typeof data.errorMessage === "string")
  );
}

function isServerToolsEvent(data: unknown): data is MoorEventData<"server:tools"> {
  return isRecord(data) && typeof data.serverId === "string";
}

function isProfileActivatedEvent(data: unknown): data is MoorEventData<"profile:activated"> {
  return isRecord(data) && typeof data.profileId === "string";
}

function isSettingsChangedEvent(data: unknown): data is MoorEventData<"settings:changed"> {
  return (
    isRecord(data) &&
    typeof data.version === "number" &&
    isRecord(data.general) &&
    isRecord(data.appearance) &&
    isRecord(data.advanced)
  );
}

export function parseMoorSSEEvent(
  event: string,
  data: unknown,
  warn: WarnFn = (message) => console.warn(message),
): MoorEvent | null {
  if (event === "connected") return null;

  switch (event) {
    case "server:status":
      return isServerStatusEvent(data) ? { type: event, data } : invalidEvent(event, warn);
    case "server:tools":
      return isServerToolsEvent(data) ? { type: event, data } : invalidEvent(event, warn);
    case "profile:activated":
      return isProfileActivatedEvent(data) ? { type: event, data } : invalidEvent(event, warn);
    case "settings:changed":
      return isSettingsChangedEvent(data) ? { type: event, data } : invalidEvent(event, warn);
    default:
      return invalidEvent(event, warn);
  }
}

export function applyMoorEventToQueryCache(queryClient: QueryClient, event: MoorEvent) {
  switch (event.type) {
    case "server:status":
      queryClient.setQueryData<Server[]>(serverKeys.list(), (servers) =>
        servers ? mergeServerStatusEvent(servers, event.data) : servers,
      );
      queryClient.setQueryData<ServerDetail>(serverKeys.detail(event.data.serverId), (server) =>
        server
          ? {
              ...server,
              status: event.data.status,
              errorMessage: event.data.errorMessage ?? null,
            }
          : server,
      );
      break;
    case "server:tools":
      void queryClient.invalidateQueries({
        queryKey: serverKeys.toolsRoot(event.data.serverId),
      });
      break;
    case "profile:activated":
      void queryClient.invalidateQueries({ queryKey: profileKeys.list() });
      void queryClient.invalidateQueries({ queryKey: serverKeys.list() });
      void queryClient.invalidateQueries({ queryKey: logKeys.all() });
      break;
    case "settings:changed":
      queryClient.setQueryData(settingKeys.all(), event.data);
      break;
  }
}

export function SSEProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
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
        const runtime = await getApiRuntime();
        const url = buildApiUrl(runtime, "/api/events");
        const headers = buildApiHeaders(runtime, {
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

            let data: unknown;
            try {
              data = JSON.parse(dataLine.slice(6));
            } catch {
              console.warn(`Dropped invalid SSE JSON for ${event}`);
              continue;
            }

            const typedEvent = parseMoorSSEEvent(event, data);
            if (!typedEvent) continue;
            applyMoorEventToQueryCache(queryClient, typedEvent);

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
  }, [queryClient]);

  const subscribe = useCallback(
    <T extends MoorEventType>(eventType: T, handler: (data: MoorEventData<T>) => void) => {
      if (!handlersRef.current.has(eventType)) {
        handlersRef.current.set(eventType, new Set());
      }
      const unknownHandler = handler as (data: unknown) => void;
      handlersRef.current.get(eventType)!.add(unknownHandler);
      return () => {
        handlersRef.current.get(eventType)?.delete(unknownHandler);
      };
    },
    [],
  );

  const value = useMemo(() => ({ subscribe }), [subscribe]);

  return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>;
}

export function useSSEEvent<T extends MoorEventType>(
  eventType: T,
  handler: (data: MoorEventData<T>) => void,
) {
  const ctx = useContext(SSEContext);
  if (!ctx) throw new Error("useSSEEvent must be used within SSEProvider");

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return ctx.subscribe(eventType, (data) => handlerRef.current(data));
  }, [ctx, eventType]);
}
