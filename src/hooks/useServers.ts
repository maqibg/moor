import { useCallback } from "react";
import { useApi } from "./useApi";
import { apiPost, apiDelete } from "@/lib/api";

export function useServers() {
  const { data: servers, loading, error, refresh, setData } = useApi<Server[]>("/api/servers", []);

  const addServer = useCallback(async (config: Omit<Server, "id" | "status" | "createdAt" | "updatedAt">) => {
    const server = await apiPost<Server>("/api/servers", config);
    setData((prev) => [...prev, server]);
    return server;
  }, [setData]);

  const startServer = useCallback(async (id: string) => {
    await apiPost(`/api/servers/${id}/start`, {});
    refresh();
  }, [refresh]);

  const stopServer = useCallback(async (id: string) => {
    await apiPost(`/api/servers/${id}/stop`, {});
    refresh();
  }, [refresh]);

  const removeServer = useCallback(async (id: string) => {
    await apiDelete(`/api/servers/${id}`);
    setData((prev) => prev.filter((s) => s.id !== id));
  }, [setData]);

  return { servers, loading, error, refresh, addServer, startServer, stopServer, removeServer };
}

export interface Server {
  id: string;
  name: string;
  connection_type: "stdio" | "http";
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  env?: Record<string, string> | null;
  working_dir?: string | null;
  status: "stopped" | "starting" | "running" | "error";
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}
