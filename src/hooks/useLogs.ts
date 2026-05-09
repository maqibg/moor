import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { routes } from "@/lib/api-routes";
import type { AuditLogEntry, LogStats } from "@moor/types";

const DEFAULT_STATS: LogStats = {
  totalCalls: 0,
  errorCalls: 0,
  errorRate: 0,
  avgDurationMs: null,
  topTools: [],
  topServers: [],
};

export function useLogs(filters?: {
  server_id?: string;
  tool_name?: string;
  from?: string;
  to?: string;
}) {
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  if (filters?.server_id) params.set("server_id", filters.server_id);
  if (filters?.tool_name) params.set("tool_name", filters.tool_name);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const qs = params.toString();
  const path = routes.logs.list(qs || undefined);

  const {
    data: logs = [],
    isLoading: loading,
    error,
  } = useQuery<AuditLogEntry[]>({
    queryKey: ["logs", filters],
    queryFn: () => api<AuditLogEntry[]>(path),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["logs"] });
  }, [queryClient]);

  return { logs, loading, error: error?.message ?? null, refresh };
}

export function useLogStats() {
  const queryClient = useQueryClient();

  const {
    data: stats = DEFAULT_STATS,
    isLoading: loading,
    error,
  } = useQuery<LogStats>({
    queryKey: ["logs", "stats"],
    queryFn: () => api<LogStats>(routes.logs.stats()),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["logs", "stats"] });
  }, [queryClient]);

  return { stats, loading, error: error?.message ?? null, refresh };
}
