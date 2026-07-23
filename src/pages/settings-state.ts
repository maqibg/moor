import {
  MCP_TIMEOUT_MS_MAX,
  MCP_TIMEOUT_MS_MIN,
  type GeneralSettings,
  type SidecarInfo,
} from "@moor/types";

export type SettingsPageLoadState =
  | { kind: "loading"; canRenderControls: false }
  | { kind: "error"; canRenderControls: false; message: string }
  | { kind: "ready"; canRenderControls: true };

export type PortBannerState =
  | { kind: "restart" }
  | {
      kind: "fallback";
      previousPort: number;
      currentPort: number;
    };

export type AdvancedPortStatus =
  | { kind: "mismatch"; currentPort: number; configuredPort: number }
  | {
      kind: "fallback";
      previousPort: number;
      currentPort: number;
    };

export type GeneralSettingRuntimeAction = "loginAutostart" | "settingsOnly" | "windowRuntime";

export type TimeoutSecondsInputState =
  | { valid: true; milliseconds: number }
  | { valid: false; message: string };

const timeoutSecondsMin = MCP_TIMEOUT_MS_MIN / 1000;
const timeoutSecondsMax = MCP_TIMEOUT_MS_MAX / 1000;
const timeoutInputError = `Enter a whole number between ${timeoutSecondsMin} and ${timeoutSecondsMax}.`;

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
  if (!runtimeInfo) {
    return null;
  }
  if (portChangeApplied && runtimeInfo.port !== configuredPort) {
    return { kind: "restart" };
  }
  if (runtimeInfo.portFallbackFrom !== null) {
    return {
      kind: "fallback",
      previousPort: runtimeInfo.portFallbackFrom,
      currentPort: runtimeInfo.port,
    };
  }
  return null;
}

export function getAdvancedPortStatus({
  runtimeInfo,
  configuredPort,
}: {
  runtimeInfo: SidecarInfo | null;
  configuredPort: number;
}): AdvancedPortStatus | null {
  if (!runtimeInfo) {
    return null;
  }
  if (runtimeInfo.portFallbackFrom !== null) {
    return {
      kind: "fallback",
      previousPort: runtimeInfo.portFallbackFrom,
      currentPort: runtimeInfo.port,
    };
  }
  if (runtimeInfo.port === configuredPort) return null;
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

export function parseTimeoutSecondsInput(value: string): TimeoutSecondsInputState {
  if (!/^\d+$/.test(value.trim())) {
    return { valid: false, message: timeoutInputError };
  }
  const seconds = Number(value);
  if (seconds < timeoutSecondsMin || seconds > timeoutSecondsMax) {
    return { valid: false, message: timeoutInputError };
  }
  return { valid: true, milliseconds: seconds * 1000 };
}
