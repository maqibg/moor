import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, apiPost } from "@/lib/api/client";
import { refreshApiRuntime } from "@/lib/api/runtime";
import { routes } from "@/lib/api-routes";
import { settingKeys } from "@/lib/query-keys";
import { applyLoginAutostartSetting, syncRuntimeSettings } from "@/lib/tauri";
import { createErrorWithCause, getErrorMessage } from "@/lib/utils";
import { useSSEEvent } from "@/contexts/SSEContext";
import {
  createDefaultSettings,
  type GeneralSettings,
  type Settings,
  type SettingsUpdatePayload,
} from "@moor/types";

const QUERY_KEY = settingKeys.all();
const MUTATION_SCOPE = { id: "settings" };

type GeneralSettingRuntimeAction = "loginAutostart" | "settingsOnly" | "windowRuntime";

export function getGeneralSettingRuntimeAction(
  key: keyof GeneralSettings,
): GeneralSettingRuntimeAction {
  if (key === "autoStartOnLogin") return "loginAutostart";
  if (key === "autoStartServersOnLaunch") return "settingsOnly";
  return "windowRuntime";
}

async function applySettingsChange(client: QueryClient, payload?: SettingsUpdatePayload) {
  const resetting = payload === undefined;
  const nextAutoStart = resetting
    ? createDefaultSettings().general.autoStartOnLogin
    : payload.general?.autoStartOnLogin;
  let previousAutoStart: boolean | undefined;
  if (nextAutoStart !== undefined) {
    // 执行时读取补偿基线，避免排队期间的缓存状态过期。
    const previous = await api<Settings>(routes.settings.get());
    previousAutoStart = previous.general.autoStartOnLogin;
    await applyLoginAutostartSetting(nextAutoStart);
  }

  let updated: Settings;
  try {
    updated = resetting
      ? await apiPost<Settings>(routes.settings.reset(), {})
      : await api<Settings>(routes.settings.update(), {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
  } catch (saveError) {
    if (previousAutoStart !== undefined) {
      try {
        await applyLoginAutostartSetting(previousAutoStart);
      } catch (rollbackError) {
        throw createErrorWithCause(
          `Unable to save settings or restore login auto-start.\nSave failed: ${getErrorMessage(saveError)}\nRollback failed: ${getErrorMessage(rollbackError)}`,
          { saveError, rollbackError },
        );
      }
    }
    throw saveError;
  }

  // 保存已完成；同步失败也必须保留新值，取消旧读取以免覆盖缓存。
  await client.cancelQueries({ queryKey: QUERY_KEY });
  client.setQueryData(QUERY_KEY, updated);
  const windowRuntimeChanged = (
    Object.keys(payload?.general ?? {}) as (keyof GeneralSettings)[]
  ).some((key) => getGeneralSettingRuntimeAction(key) === "windowRuntime");
  try {
    if (resetting) await refreshApiRuntime();
    if (resetting || windowRuntimeChanged) await syncRuntimeSettings();
  } catch (runtimeError) {
    throw createErrorWithCause(
      `Settings were saved, but applying runtime settings failed.\n${getErrorMessage(runtimeError)}`,
      runtimeError,
    );
  }
  return updated;
}

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
    scope: MUTATION_SCOPE,
    mutationFn: (payload: SettingsUpdatePayload) => applySettingsChange(queryClient, payload),
  });

  const resetSettings = useMutation({
    scope: MUTATION_SCOPE,
    mutationFn: () => applySettingsChange(queryClient),
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
