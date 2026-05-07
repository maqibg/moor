import type { GeneralSettings, SidecarInfo } from "@moor/types";

export type SettingsPageLoadState =
  | { kind: "loading"; canRenderControls: false }
  | { kind: "error"; canRenderControls: false; message: string }
  | { kind: "ready"; canRenderControls: true };

export type PortBannerState = { kind: "restart" };

export type AdvancedPortStatus = { kind: "mismatch"; currentPort: number; configuredPort: number };

export type GeneralSettingRuntimeAction = "loginAutostart" | "settingsOnly" | "windowRuntime";

export function getSettingsPageLoadState({
  isLoading,
  isError,
  error,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}): SettingsPageLoadState {
  if (isLoading) {
    return { kind: "loading", canRenderControls: false };
  }
  if (isError) {
    return {
      kind: "error",
      canRenderControls: false,
      message: error instanceof Error ? error.message : "Failed to load settings",
    };
  }
  return { kind: "ready", canRenderControls: true };
}

export function getPortBannerState({
  runtimeInfo,
  configuredPort,
  portChangeApplied,
}: {
  runtimeInfo: SidecarInfo | null;
  configuredPort: number;
  portChangeApplied: boolean;
}): PortBannerState | null {
  if (!runtimeInfo || runtimeInfo.port === configuredPort) {
    return null;
  }
  return portChangeApplied ? { kind: "restart" } : null;
}

export function getAdvancedPortStatus({
  runtimeInfo,
  configuredPort,
}: {
  runtimeInfo: SidecarInfo | null;
  configuredPort: number;
}): AdvancedPortStatus | null {
  if (!runtimeInfo || runtimeInfo.port === configuredPort) {
    return null;
  }
  return { kind: "mismatch", currentPort: runtimeInfo.port, configuredPort };
}

export function getGeneralSettingRuntimeAction(
  key: keyof GeneralSettings,
): GeneralSettingRuntimeAction {
  if (key === "autoStartOnLogin") {
    return "loginAutostart";
  }
  if (key === "autoStartServersOnLaunch") {
    return "settingsOnly";
  }
  return "windowRuntime";
}
