import type { QueryClient } from "@tanstack/react-query";
import { serverKeys } from "@/lib/query-keys";
import type { Server, ServerAction, ServerDetail, ServerStatus } from "@moor/types";

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

// "stopping" 仅是显示态：停止期间持久 status 仍是 running
export type DisplayServerStatus = ServerStatus | "stopping";

export interface DisplayStatus {
  status: DisplayServerStatus;
  isStarting: boolean;
  isStopping: boolean;
}

export interface ServerPatches {
  list: Partial<Server>;
  detail: Partial<ServerDetail>;
}

export function resolveDisplayStatus(
  server: ServerStateItem,
  action?: ServerAction | null,
): DisplayStatus {
  const isStopping = action === "stopping";
  return {
    status: isStopping ? "stopping" : server.status,
    isStarting: server.status === "starting" || action === "starting",
    isStopping,
  };
}

// 启停乐观态：list/detail 双通道共用同一推导
export function optimisticTransition(action: ServerAction): ServerPatches {
  if (action === "starting") {
    return {
      list: { status: "starting", errorMessage: null },
      detail: { status: "starting", errorMessage: null },
    };
  }
  return { list: { errorMessage: null }, detail: { errorMessage: null } };
}

export function failedTransition(errorMessage: string): ServerPatches {
  const error = { status: "error" as const, errorMessage };
  return { list: error, detail: error };
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
