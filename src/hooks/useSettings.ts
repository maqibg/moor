import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiPost } from "@/lib/api";
import { useSSEEvent } from "@/contexts/SSEContext";
import { createDefaultSettings, type Settings, type SettingsUpdatePayload } from "@moor/types";

const QUERY_KEY = ["settings"] as const;

export function useSettings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: QUERY_KEY,
    queryFn: () => api<Settings>("/api/settings"),
  });

  const updateSettings = useMutation({
    mutationFn: (payload: SettingsUpdatePayload) =>
      api<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
    },
  });

  const resetSettings = useMutation({
    mutationFn: () => apiPost<Settings>("/api/settings/reset", {}),
    onSuccess: (defaults) => {
      queryClient.setQueryData(QUERY_KEY, defaults);
    },
  });

  useSSEEvent("settings:changed", (data) => {
    queryClient.setQueryData(QUERY_KEY, data as Settings);
  });

  return {
    settings: settings ?? createDefaultSettings(),
    isLoading,
    updateSettings: updateSettings.mutateAsync,
    resetSettings: resetSettings.mutateAsync,
  };
}
