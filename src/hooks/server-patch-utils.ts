import type { QueryClient } from "@tanstack/react-query";
import { serverKeys } from "@/lib/query-keys";
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

export async function syncUpdatedServerCaches(
  queryClient: QueryClient,
  updated: Server,
  id: string,
): Promise<void> {
  queryClient.setQueryData<Server[]>(serverKeys.list(), (prev) =>
    prev?.map((server) => (server.id === id ? { ...server, ...updated } : server)),
  );
  await queryClient.invalidateQueries({ queryKey: serverKeys.detail(id) });
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
