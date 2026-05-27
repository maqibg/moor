import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SidecarInfo } from "@moor/types";

export function isTauriRuntime(): boolean {
  return isTauri();
}

export async function getSidecarInfo(): Promise<SidecarInfo> {
  return invoke<SidecarInfo>("get_sidecar_info");
}

export async function syncRuntimeSettings(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("sync_runtime_settings");
}

export async function applyLoginAutostartSetting(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("apply_login_autostart_setting", { enabled });
}

export async function restartSidecar(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Restart is only available in the Tauri desktop runtime.");
  }
  await invoke("restart_sidecar");
}
