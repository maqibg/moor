import type { QueryClient } from "@tanstack/react-query";
import { isRecord } from "@/lib/utils";
import type { Server, ServerAction, ServerStatus } from "@moor/types";

export { ServerAction, ServerStatus };

export interface ServerStateItem {
  id: string;
  status: ServerStatus;
  errorMessage?: string | null;
}

export interface ServerStatusEventPayload {
  serverId: string;
  status: ServerStatus;
  errorMessage?: string | null;
}

const serverStatuses = ["stopped", "starting", "running", "error"] satisfies ServerStatus[];

function isServerStatus(value: unknown): value is ServerStatus {
  return typeof value === "string" && serverStatuses.includes(value as ServerStatus);
}

export async function syncUpdatedServerCaches(
  queryClient: QueryClient,
  updated: Server,
  id: string,
): Promise<void> {
  queryClient.setQueryData<Server[]>(["servers"], (prev) =>
    prev?.map((server) => (server.id === id ? { ...server, ...updated } : server)),
  );
  await queryClient.invalidateQueries({ queryKey: ["servers", id] });
}

export function getServerStatusEventPayload(eventData: unknown): ServerStatusEventPayload | null {
  if (!isRecord(eventData)) return null;

  const payload = isRecord(eventData.data) ? eventData.data : eventData;
  const serverId = payload.serverId;
  const status = payload.status;

  if (typeof serverId !== "string" || !isServerStatus(status)) return null;

  return {
    serverId,
    status,
    errorMessage: typeof payload.errorMessage === "string" ? payload.errorMessage : null,
  };
}

export function applyServerAction<TServer extends ServerStateItem>(
  servers: TServer[],
  serverId: string,
  action: ServerAction,
): TServer[] {
  return servers.map((server) => {
    if (server.id !== serverId) return server;
    if (action === "starting") {
      return { ...server, status: "starting", errorMessage: null };
    }
    return { ...server, errorMessage: null };
  });
}

export function mergeServerStatusEvent<TServer extends ServerStateItem>(
  servers: TServer[],
  payload: ServerStatusEventPayload,
): TServer[] {
  return servers.map((server) => {
    if (server.id !== payload.serverId) return server;

    return {
      ...server,
      status: payload.status,
      errorMessage: payload.status === "error" ? payload.errorMessage : null,
    };
  });
}
