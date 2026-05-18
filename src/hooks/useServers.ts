import { useCallback, useState, type SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiPost, apiPut, apiDelete } from "@/lib/api/client";
import { routes } from "@/lib/api-routes";
import { useSSEEvent } from "@/contexts/SSEContext";
import type { Server, ServerDetail, ToolDetail } from "@moor/types";
import { getErrorMessage } from "@/lib/utils";
import {
  applyServerAction,
  getServerStatusEventPayload,
  mergeServerStatusEvent,
  syncUpdatedServerCaches,
  type ServerAction,
} from "./server-patch-utils";

type ServerMutationResult = "success" | "failed";

export function useServerList() {
  const queryClient = useQueryClient();

  const {
    data: servers = [],
    isLoading: loading,
    error,
  } = useQuery<Server[]>({
    queryKey: ["servers"],
    queryFn: ({ signal }) => api<Server[]>(routes.servers.list(), { signal }),
  });

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

  const setData = useCallback(
    (updater: SetStateAction<Server[]>) => {
      queryClient.setQueryData<Server[]>(["servers"], (old) => {
        const prev = old ?? [];
        return typeof updater === "function" ? updater(prev) : updater;
      });
    },
    [queryClient],
  );

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

  const refreshSilently = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ["servers"] });
  }, [queryClient]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["servers"] });
  }, [queryClient]);

  useSSEEvent("server:status", (data) => mergeStatusEvent(data));
  useSSEEvent("server:tools", () => void refreshSilently());

  return {
    servers,
    loading,
    error: error?.message ?? null,
    refresh,
    refreshSilently,
    serverActions,
    setServerAction,
    clearServerAction,
    setData,
  };
}

export function useServerActions(callbacks?: {
  setServerAction?: (id: string, action: ServerAction) => void;
  clearServerAction?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { setServerAction, clearServerAction } = callbacks ?? {};

  const setServersData = useCallback(
    (updater: SetStateAction<Server[]>) => {
      queryClient.setQueryData<Server[]>(["servers"], (old) => {
        const prev = old ?? [];
        return typeof updater === "function" ? updater(prev) : updater;
      });
    },
    [queryClient],
  );

  const setServerDetailPatch = useCallback(
    (id: string, patch: Partial<ServerDetail>) => {
      queryClient.setQueryData<ServerDetail>(["servers", id], (prev) =>
        prev ? { ...prev, ...patch } : prev,
      );
    },
    [queryClient],
  );

  const refreshAfterServerMutation = useCallback(
    async (id: string) => {
      await queryClient.refetchQueries({ queryKey: ["servers"] });
      await queryClient.invalidateQueries({ queryKey: ["servers", id] });
    },
    [queryClient],
  );

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

  const startServer = useMutation<ServerMutationResult, Error, string>({
    mutationFn: async (id: string) => {
      setServerAction?.(id, "starting");
      setServersData((prev) => applyServerAction(prev, id, "starting"));
      setServerDetailPatch(id, { status: "starting", errorMessage: null });
      try {
        await apiPost(routes.servers.start(id), {});
        return "success";
      } catch (err) {
        const errorMessage = getErrorMessage(err);
        setServersData((prev) =>
          mergeServerStatusEvent(prev, {
            serverId: id,
            status: "error",
            errorMessage,
          }),
        );
        setServerDetailPatch(id, { status: "error", errorMessage });
        return "failed";
      }
    },
    onSettled: (result, _err, id) => {
      clearServerAction?.(id);
      if (result === "success") void refreshAfterServerMutation(id);
    },
  });

  const stopServer = useMutation<ServerMutationResult, Error, string>({
    mutationFn: async (id: string) => {
      setServerAction?.(id, "stopping");
      setServersData((prev) => applyServerAction(prev, id, "stopping"));
      setServerDetailPatch(id, { errorMessage: null });
      try {
        await apiPost(routes.servers.stop(id), {});
        return "success";
      } catch (err) {
        const errorMessage = getErrorMessage(err);
        setServersData((prev) =>
          mergeServerStatusEvent(prev, {
            serverId: id,
            status: "error",
            errorMessage,
          }),
        );
        setServerDetailPatch(id, { status: "error", errorMessage });
        return "failed";
      }
    },
    onSettled: (result, _err, id) => {
      clearServerAction?.(id);
      if (result === "success") void refreshAfterServerMutation(id);
    },
  });

  const updateServer = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      return apiPut<Server>(routes.servers.update(id), updates);
    },
    onSuccess: (updated, { id }) => {
      return syncUpdatedServerCaches(queryClient, updated, id);
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

  const reorderServers = useMutation({
    mutationFn: async (nextServers: Server[]) => {
      const ordered = await apiPut<Server[]>(routes.servers.order(), {
        serverIds: nextServers.map((server) => server.id),
      });
      return ordered;
    },
    onMutate: async (nextServers) => {
      await queryClient.cancelQueries({ queryKey: ["servers"] });
      const previous = queryClient.getQueryData<Server[]>(["servers"]);
      queryClient.setQueryData<Server[]>(["servers"], nextServers);
      return { previous };
    },
    onSuccess: (ordered) => {
      queryClient.setQueryData<Server[]>(["servers"], ordered);
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData<Server[]>(["servers"], context.previous);
      }
    },
  });

  return {
    addServer: addServer.mutateAsync,
    updateServer: updateServer.mutateAsync,
    startServer: async (id: string) => {
      await startServer.mutateAsync(id);
    },
    stopServer: async (id: string) => {
      await stopServer.mutateAsync(id);
    },
    removeServer: removeServer.mutateAsync,
    reorderServers: reorderServers.mutateAsync,
  };
}

export function useServers() {
  const list = useServerList();
  const actions = useServerActions({
    setServerAction: list.setServerAction,
    clearServerAction: list.clearServerAction,
  });

  return {
    servers: list.servers,
    loading: list.loading,
    error: list.error,
    refresh: list.refresh,
    refreshSilently: list.refreshSilently,
    serverActions: list.serverActions,
    ...actions,
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
    queryFn: ({ signal }) => api<ServerDetail>(routes.servers.detail(id!), { signal }),
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
    queryFn: ({ signal }) =>
      api<ToolDetail[]>(routes.servers.tools(serverId!, profileId), { signal }),
    enabled: !!serverId,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["servers", serverId, "tools"] });
  }, [queryClient, serverId]);

  return { tools, refresh };
}

export type { ServerAction };
