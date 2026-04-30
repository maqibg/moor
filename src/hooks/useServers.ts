import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useApi } from "./useApi";
import { apiPost, apiDelete } from "@/lib/api";
import {
  applyServerAction,
  getServerStatusEventPayload,
  mergeServerStatusEvent,
  type ServerAction,
  type ServerStatus,
} from "./useServersState";

type ServerSetter = Dispatch<SetStateAction<Server[]>>;
type SetServerAction = (id: string, action: ServerAction) => void;
type ClearServerAction = (id: string) => void;

interface RunServerMutationOptions {
  id: string;
  action: ServerAction;
  path: string;
  setData: ServerSetter;
  setServerAction: SetServerAction;
  clearServerAction: ClearServerAction;
  refreshSilently: () => Promise<void>;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown server action error";
}

function applyServerError(setData: ServerSetter, id: string, err: unknown) {
  setData((prev) =>
    mergeServerStatusEvent(prev, {
      serverId: id,
      status: "error",
      errorMessage: getErrorMessage(err),
    }),
  );
}

async function runServerMutation(options: RunServerMutationOptions) {
  options.setServerAction(options.id, options.action);
  options.setData((prev) => applyServerAction(prev, options.id, options.action));

  let shouldRefresh = false;
  try {
    await apiPost(options.path, {});
    shouldRefresh = true;
  } catch (err) {
    applyServerError(options.setData, options.id, err);
  } finally {
    try {
      if (shouldRefresh) await options.refreshSilently();
    } finally {
      options.clearServerAction(options.id);
    }
  }
}

function useServerActionState(setData: ServerSetter) {
  const [serverActions, setServerActions] = useState<Record<string, ServerAction>>({});

  const setServerAction = useCallback((id: string, action: ServerAction) => {
    setServerActions((prev) => ({ ...prev, [id]: action }));
  }, []);

  const clearServerAction = useCallback((id: string) => {
    setServerActions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const mergeStatusEvent = useCallback(
    (eventData: unknown) => {
      const payload = getServerStatusEventPayload(eventData);
      if (!payload) return;
      setData((prev) => mergeServerStatusEvent(prev, payload));
      if (payload.status !== "starting") {
        clearServerAction(payload.serverId);
      }
    },
    [clearServerAction, setData],
  );

  return { serverActions, setServerAction, clearServerAction, mergeStatusEvent };
}

export function useServers() {
  const { data: servers, loading, error, refresh, setData } = useApi<Server[]>("/api/servers", []);
  const { serverActions, setServerAction, clearServerAction, mergeStatusEvent } =
    useServerActionState(setData);

  const refreshSilently = useCallback(async () => {
    await refresh({ silent: true });
  }, [refresh]);

  const addServer = useCallback(
    async (config: Omit<Server, "id" | "status" | "createdAt" | "updatedAt">) => {
      const server = await apiPost<Server>("/api/servers", config);
      setData((prev) => [...prev, server]);
      return server;
    },
    [setData],
  );

  const startServer = useCallback(
    async (id: string) => {
      await runServerMutation({
        id,
        action: "starting",
        path: `/api/servers/${id}/start`,
        setData,
        setServerAction,
        clearServerAction,
        refreshSilently,
      });
    },
    [clearServerAction, refreshSilently, setData, setServerAction],
  );

  const stopServer = useCallback(
    async (id: string) => {
      await runServerMutation({
        id,
        action: "stopping",
        path: `/api/servers/${id}/stop`,
        setData,
        setServerAction,
        clearServerAction,
        refreshSilently,
      });
    },
    [clearServerAction, refreshSilently, setData, setServerAction],
  );

  const removeServer = useCallback(
    async (id: string) => {
      await apiDelete(`/api/servers/${id}`);
      setData((prev) => prev.filter((s) => s.id !== id));
      clearServerAction(id);
    },
    [clearServerAction, setData],
  );

  return {
    servers,
    loading,
    error,
    refresh,
    refreshSilently,
    serverActions,
    mergeStatusEvent,
    addServer,
    startServer,
    stopServer,
    removeServer,
  };
}

export interface Server {
  id: string;
  name: string;
  connection_type: "stdio" | "http";
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  working_dir?: string | null;
  status: ServerStatus;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}
