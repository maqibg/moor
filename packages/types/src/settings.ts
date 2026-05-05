export type ThemeMode = "light" | "dark" | "system";

export interface GeneralSettings {
  autoStartOnLogin: boolean;
  autoStartServersOnLaunch: boolean;
  minimizeToTrayOnClose: boolean;
  showWindowOnLaunch: boolean;
}

export interface AppearanceSettings {
  theme: ThemeMode;
}

export interface AdvancedSettings {
  logRetentionDays: number;
  enableAuditLogging: boolean;
  sidecarPort: number;
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
      showWindowOnLaunch: true,
    },
    appearance: { theme: "system" },
    advanced: {
      logRetentionDays: 30,
      enableAuditLogging: true,
      sidecarPort: 9223,
    },
  };
}
