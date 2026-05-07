import { describe, expect, it } from "vite-plus/test";
import type { GeneralSettings, SidecarInfo } from "@moor/types";
import {
  getAdvancedPortStatus,
  getGeneralSettingRuntimeAction,
  getPortBannerState,
  getSettingsPageLoadState,
} from "./settings-state";

const runtimeInfo = (port: number): SidecarInfo => ({
  port,
  baseUrl: `http://127.0.0.1:${port}`,
  apiToken: "token",
});

describe("settings page state helpers", () => {
  it("blocks settings controls when the settings query failed", () => {
    expect(
      getSettingsPageLoadState({
        isLoading: false,
        isError: true,
        error: new Error("Unable to connect"),
      }),
    ).toEqual({
      kind: "error",
      canRenderControls: false,
      message: "Unable to connect",
    });
  });

  it("does not show a page banner for automatic runtime port fallback", () => {
    expect(
      getPortBannerState({
        runtimeInfo: runtimeInfo(9224),
        configuredPort: 9223,
        portChangeApplied: false,
      }),
    ).toBeNull();
  });

  it("shows automatic runtime port fallback as an advanced inline status", () => {
    expect(
      getAdvancedPortStatus({
        runtimeInfo: runtimeInfo(9224),
        configuredPort: 9223,
      }),
    ).toEqual({
      kind: "mismatch",
      currentPort: 9224,
      configuredPort: 9223,
    });
  });

  it("shows a restart banner only after the user applies a port change", () => {
    expect(
      getPortBannerState({
        runtimeInfo: runtimeInfo(9223),
        configuredPort: 9224,
        portChangeApplied: true,
      }),
    ).toEqual({
      kind: "restart",
    });
  });

  it("does not show a port banner when runtime and configured ports match", () => {
    expect(
      getPortBannerState({
        runtimeInfo: runtimeInfo(9223),
        configuredPort: 9223,
        portChangeApplied: true,
      }),
    ).toBeNull();
  });

  it("keeps server auto-start independent from login item runtime sync", () => {
    const actions: Record<
      keyof GeneralSettings,
      ReturnType<typeof getGeneralSettingRuntimeAction>
    > = {
      autoStartOnLogin: getGeneralSettingRuntimeAction("autoStartOnLogin"),
      autoStartServersOnLaunch: getGeneralSettingRuntimeAction("autoStartServersOnLaunch"),
      minimizeToTrayOnClose: getGeneralSettingRuntimeAction("minimizeToTrayOnClose"),
      showWindowOnLaunch: getGeneralSettingRuntimeAction("showWindowOnLaunch"),
    };

    expect(actions).toEqual({
      autoStartOnLogin: "loginAutostart",
      autoStartServersOnLaunch: "settingsOnly",
      minimizeToTrayOnClose: "windowRuntime",
      showWindowOnLaunch: "windowRuntime",
    });
  });
});
