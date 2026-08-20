import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiPost } from "@/lib/api/client";
import { routes } from "@/lib/api-routes";
import { settingKeys } from "@/lib/query-keys";
import { useSSEEvent } from "@/contexts/SSEContext";
import { createDefaultSettings, type Settings, type SettingsUpdatePayload } from "@moor/types";

const QUERY_KEY = settingKeys.all();

export function useSettings() {
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    isError,
    error,
    isFetched,
  } = useQuery<Settings>({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => api<Settings>(routes.settings.get(), { signal }),
  });

  const updateSettings = useMutation({
    mutationFn: (payload: SettingsUpdatePayload) =>
      api<Settings>(routes.settings.update(), {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
    },
  });

  const resetSettings = useMutation({
    mutationFn: () => apiPost<Settings>(routes.settings.reset(), {}),
    onSuccess: (defaults) => {
      queryClient.setQueryData(QUERY_KEY, defaults);
    },
  });

  // SSE 载荷仅作变更信号：不直写缓存（避免畸形载荷毒化），数据回归 GET 的类型化通道
  useSSEEvent("settings:changed", () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  });

  return {
    settings: settings ?? createDefaultSettings(),
    isLoading,
    isError,
    error,
    isFetched,
    updateSettings: updateSettings.mutateAsync,
    resetSettings: resetSettings.mutateAsync,
  };
}
