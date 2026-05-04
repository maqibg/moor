import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useSSEEvent } from "@/contexts/SSEContext";
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
  refreshSilently: () => void;
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
  const queryClient = useQueryClient();

  const {
    data: servers = [],
    isLoading: loading,
    error,
  } = useQuery<Server[]>({
    queryKey: ["servers"],
    queryFn: () => api<Server[]>("/api/servers"),
  });

  const setData = useCallback(
    (updater: SetStateAction<Server[]>) => {
      queryClient.setQueryData<Server[]>(["servers"], (old) => {
        const prev = old ?? [];
        return typeof updater === "function" ? updater(prev) : updater;
      });
    },
    [queryClient],
  );

  const { serverActions, setServerAction, clearServerAction, mergeStatusEvent } =
    useServerActionState(setData);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["servers"] });
  }, [queryClient]);

  const refreshSilently = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ["servers"] });
  }, [queryClient]);

  const addServer = useMutation({
    mutationFn: async (config: {
      name: string;
      connectionType: "stdio" | "http";
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      headers?: Record<string, string>;
      autoStart?: boolean;
    }) => {
      return apiPost<Server>("/api/servers", config);
    },
    onSuccess: (server) => {
      queryClient.setQueryData<Server[]>(["servers"], (prev) => [...(prev ?? []), server]);
    },
  });

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

  const updateServer = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      return apiPut<Server>(`/api/servers/${id}`, updates);
    },
    onSuccess: (updated, { id }) => {
      queryClient.setQueryData<Server[]>(["servers"], (prev) =>
        prev?.map((s) => (s.id === id ? { ...s, ...updated } : s)),
      );
      queryClient.invalidateQueries({ queryKey: ["servers", id] });
    },
  });

  const removeServer = useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/servers/${id}`);
    },
    onSuccess: (_data, id) => {
      queryClient.setQueryData<Server[]>(["servers"], (prev) => prev?.filter((s) => s.id !== id));
    },
  });

  useSSEEvent("server:status", (data) => mergeStatusEvent(data));
  useSSEEvent("server:tools", () => void refreshSilently());

  return {
    servers,
    loading,
    error: error?.message ?? null,
    refresh,
    refreshSilently,
    serverActions,
    mergeStatusEvent,
    addServer: addServer.mutateAsync,
    updateServer: updateServer.mutateAsync,
    startServer,
    stopServer,
    removeServer: removeServer.mutateAsync,
  };
}

export interface Server {
  id: string;
  name: string;
  connectionType: "stdio" | "http";
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  workingDir?: string | null;
  autoStart?: boolean;
  status: ServerStatus;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}
