import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { routes } from "@/lib/api-routes";
import { logKeys } from "@/lib/query-keys";
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

  const path = routes.logs.list(filters);

  const {
    data: logs = [],
    isLoading: loading,
    error,
  } = useQuery<AuditLogEntry[]>({
    queryKey: logKeys.list(filters),
    queryFn: ({ signal }) => api<AuditLogEntry[]>(path, { signal }),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: logKeys.all() });
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
    queryKey: logKeys.stats(),
    queryFn: ({ signal }) => api<LogStats>(routes.logs.stats(), { signal }),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: logKeys.stats() });
  }, [queryClient]);

  return { stats, loading, error: error?.message ?? null, refresh };
}
