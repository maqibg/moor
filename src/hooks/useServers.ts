import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiPost, apiPut, apiDelete } from "@/lib/api";
import { routes } from "@/lib/api-routes";
import { useSSEEvent } from "@/contexts/SSEContext";
import type { Server, ServerDetail, ToolDetail } from "@moor/types";
import {
  applyServerAction,
  getServerStatusEventPayload,
  mergeServerStatusEvent,
  type ServerAction,
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
    queryFn: () => api<Server[]>(routes.servers.list()),
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
      return apiPost<Server>(routes.servers.create(), config);
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
        path: routes.servers.start(id),
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
        path: routes.servers.stop(id),
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
      return apiPut<Server>(routes.servers.update(id), updates);
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
      await apiDelete(routes.servers.delete(id));
    },
    onSuccess: (_data, id) => {
      queryClient.setQueryData<Server[]>(["servers"], (prev) => prev?.filter((s) => s.id !== id));
    },
  });

  const reorderServers = useCallback(
    async (nextServers: Server[]) => {
      const previous = queryClient.getQueryData<Server[]>(["servers"]) ?? servers;
      queryClient.setQueryData<Server[]>(["servers"], nextServers);
      try {
        const ordered = await apiPut<Server[]>(routes.servers.order(), {
          serverIds: nextServers.map((server) => server.id),
        });
        queryClient.setQueryData<Server[]>(["servers"], ordered);
        return ordered;
      } catch (err) {
        queryClient.setQueryData<Server[]>(["servers"], previous);
        await refreshSilently();
        throw err;
      }
    },
    [queryClient, refreshSilently, servers],
  );

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
    reorderServers,
  };
}

export function useServer(id: string | undefined) {
  const queryClient = useQueryClient();

  const {
    data: server,
    isLoading,
    error,
  } = useQuery<ServerDetail>({
    queryKey: ["servers", id],
    queryFn: () => api<ServerDetail>(routes.servers.detail(id!)),
    enabled: !!id,
  });

  useSSEEvent("server:status", (eventData) => {
    const payload = getServerStatusEventPayload(eventData);
    if (payload && payload.serverId === id) {
      void queryClient.invalidateQueries({ queryKey: ["servers", id] });
    }
  });

  return { server, isLoading, error };
}

export function useServerTools(serverId: string | undefined, profileId?: string) {
  const queryClient = useQueryClient();

  const { data: tools = [] } = useQuery<ToolDetail[]>({
    queryKey: ["servers", serverId, "tools", profileId],
    queryFn: () => api<ToolDetail[]>(routes.servers.tools(serverId!, profileId)),
    enabled: !!serverId,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["servers", serverId, "tools"] });
  }, [queryClient, serverId]);

  return { tools, refresh };
}
