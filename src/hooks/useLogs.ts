import { useApi } from "./useApi";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  profile_id: string | null;
  server_id: string | null;
  tool_name: string;
  arguments: unknown;
  result: unknown | null;
  error: string | null;
  duration_ms: number | null;
  agent_info: string | null;
}

export interface LogStats {
  totalCalls: number;
  errorCalls: number;
  errorRate: number;
  avgDurationMs: number | null;
  topTools: Array<{ tool_name: string; count: number; avg_duration: number }>;
  topServers: Array<{ server_id: string; count: number }>;
}

export function useLogs(filters?: {
  server_id?: string;
  tool_name?: string;
  from?: string;
  to?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.server_id) params.set("server_id", filters.server_id);
  if (filters?.tool_name) params.set("tool_name", filters.tool_name);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);

  const qs = params.toString();
  const path = `/api/logs${qs ? `?${qs}` : ""}`;

  const { data: logs, loading, error, refresh } = useApi<AuditLogEntry[]>(path, []);
  return { logs, loading, error, refresh };
}

export function useLogStats() {
  const {
    data: stats,
    loading,
    error,
    refresh,
  } = useApi<LogStats>("/api/logs/stats", {
    totalCalls: 0,
    errorCalls: 0,
    errorRate: 0,
    avgDurationMs: null,
    topTools: [],
    topServers: [],
  });
  return { stats, loading, error, refresh };
}
