import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, apiPost } from "@/lib/api/client";
import { refreshApiRuntime } from "@/lib/api/runtime";
import { routes } from "@/lib/api-routes";
import { settingKeys } from "@/lib/query-keys";
import { applyLoginAutostartSetting, syncRuntimeSettings } from "@/lib/tauri";
import { createErrorWithCause, getErrorMessage } from "@/lib/utils";
import { getGeneralSettingRuntimeAction } from "@/pages/settings-state";
import {
  createDefaultSettings,
  type GeneralSettings,
  type Settings,
  type SettingsUpdatePayload,
} from "@moor/types";

const QUERY_KEY = settingKeys.all();
// 同一作用域的 mutation 会排队执行：连续改动设置不会并发写库、互相覆盖。
const MUTATION_SCOPE = { id: "settings" };

/**
 * 保存设置（payload 为空 = 恢复默认）并处理登录自启与运行期同步：
 * 登录自启的补偿基线在执行时才读取（排队期间缓存可能已过期，简单取反会回滚错）；
 * 保存成功后即使运行期同步失败也保留新值，只把失败如实报出来。
 */
async function applySettingsChange(client: QueryClient, payload?: SettingsUpdatePayload) {
  const resetting = payload === undefined;
  const nextAutoStart = resetting
    ? createDefaultSettings().general.autoStartOnLogin
    : payload.general?.autoStartOnLogin;
  let previousAutoStart: boolean | undefined;
  if (nextAutoStart !== undefined) {
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
