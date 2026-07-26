import { useCallback } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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

export type LogFilters = {
  server_id?: string;
  tool_name?: string;
  from?: string;
  to?: string;
  limit?: number;
};

const LOG_PAGE_SIZE = 50;

export function useLogs(filters?: LogFilters) {
  const queryClient = useQueryClient();

  const path = routes.logs.list(filters);

  const {
    data: logs = [],
    isLoading: loading,
    error,
  } = useQuery<AuditLogEntry[]>({
    queryKey: logKeys.list(filters),
    queryFn: ({ signal }) => api<AuditLogEntry[]>(path, { signal }),
    placeholderData: keepPreviousData,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: logKeys.all() });
  }, [queryClient]);

  return { logs, loading, error: error?.message ?? null, refresh };
}

export function useInfiniteLogs(filters?: Omit<LogFilters, "limit">) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: logKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      api<AuditLogEntry[]>(
        routes.logs.list({ ...filters, limit: LOG_PAGE_SIZE, offset: pageParam }),
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === LOG_PAGE_SIZE ? allPages.length * LOG_PAGE_SIZE : undefined,
    placeholderData: keepPreviousData,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: logKeys.list(filters) });
  }, [filters, queryClient]);

  return {
    logs: query.data?.pages.flat() ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
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
