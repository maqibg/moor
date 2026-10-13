import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerHealth } from "@moor/types";
import { api, apiPost } from "@/lib/api/client";
import { routes } from "@/lib/api-routes";
import { serverKeys } from "@/lib/query-keys";
import { getErrorMessage } from "@/lib/utils";
import { healthCheckErrorKey, mergeServerHealthSnapshot } from "@/lib/server-health";

/**
 * 手动探测单个服务器并回写快照缓存。写成共享回调是为了让 useServerHealth 与
 * useHealthCheck 复用同一条写入路径，同时避免每个卡片都订阅一次快照查询。
 */
function useCheckServerHealth() {
  const queryClient = useQueryClient();

  return useCallback(
    async (serverId: string) => {
      const snapshot = await apiPost<ServerHealth>(routes.servers.checkHealth(serverId), {});
      queryClient.setQueryData<ServerHealth[]>(serverKeys.health(), (previous) =>
        mergeServerHealthSnapshot(previous, snapshot),
      );
      return snapshot;
    },
    [queryClient],
  );
}

/**
 * 健康快照列表。SSE 的 server:health 合并与 server:status 失效都在 SSEProvider
 * 边界完成（见 contexts/SSEContext），这里只负责查询与手动探测。
 */
export function useServerHealth() {
  const {
    data: snapshots = [],
    isLoading,
    error,
  } = useQuery<ServerHealth[]>({
    queryKey: serverKeys.health(),
    queryFn: ({ signal }) => api<ServerHealth[]>(routes.servers.health(), { signal }),
  });

  return { snapshots, isLoading, error, check: useCheckServerHealth() };
}

/**
 * 手动探测单个服务器。409（未运行 / 会话变更）与 404 由 onError 收敛成可见错误，
 * 不会以未处理的 rejection 形式冒泡。
 */
export function useHealthCheck(serverId: string) {
  const checkServerHealth = useCheckServerHealth();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => checkServerHealth(serverId),
    onMutate: () => setErrorKey(null),
    onError: (err) => setErrorKey(healthCheckErrorKey(getErrorMessage(err))),
  });

  const clearError = useCallback(() => setErrorKey(null), []);

  return {
    check: () => mutation.mutate(),
    pending: mutation.isPending,
    errorKey,
    clearError,
  };
}
