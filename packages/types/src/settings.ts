export type ThemeMode = "light" | "dark" | "system";

export const MCP_TIMEOUT_MS_MIN = 5_000;
export const MCP_TIMEOUT_MS_MAX = 300_000;
export const MCP_TIMEOUT_MS_DEFAULT = 30_000;

export interface GeneralSettings {
  autoStartOnLogin: boolean;
  autoStartServersOnLaunch: boolean;
  minimizeToTrayOnClose: boolean;
  hideDockIconOnClose: boolean;
  showWindowOnLaunch: boolean;
}

export interface AppearanceSettings {
  theme: ThemeMode;
}

export interface AdvancedSettings {
  logRetentionDays: number;
  enableAuditLogging: boolean;
  sidecarPort: number;
  allowLanMcpAccess: boolean;
  mcpRequestTimeoutMs: number;
  mcpServerStartTimeoutMs: number;
}

export interface Settings {
  version: number;
  general: GeneralSettings;
  appearance: AppearanceSettings;
  advanced: AdvancedSettings;
}

export type SettingsGroup = "general" | "appearance" | "advanced";

export type SettingsUpdatePayload = {
  general?: Partial<GeneralSettings>;
  appearance?: Partial<AppearanceSettings>;
  advanced?: Partial<AdvancedSettings>;
};

export function createDefaultSettings(): Settings {
  return {
    version: 1,
    general: {
      autoStartOnLogin: false,
      autoStartServersOnLaunch: false,
      minimizeToTrayOnClose: true,
      hideDockIconOnClose: false,
      showWindowOnLaunch: true,
    },
    appearance: { theme: "system" },
    advanced: {
      logRetentionDays: 30,
      enableAuditLogging: true,
      sidecarPort: 9223,
      allowLanMcpAccess: false,
      mcpRequestTimeoutMs: MCP_TIMEOUT_MS_DEFAULT,
      mcpServerStartTimeoutMs: MCP_TIMEOUT_MS_DEFAULT,
    },
  };
}
