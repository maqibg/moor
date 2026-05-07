import fs from "node:fs";
import path from "node:path";
import { run, transaction, getDb } from "../db/index.js";
import { eventBus } from "./event-bus.js";
import { createDefaultSettings, type Settings, type SettingsUpdatePayload } from "@moor/types";

const SETTINGS_FILE = "settings.json";
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

import { isRecord } from "../utils.js";

function isThemeMode(value: unknown): value is Settings["appearance"]["theme"] {
  return value === "light" || value === "dark" || value === "system";
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integerInRangeOrDefault(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function mergeStoredSettings(raw: unknown): Settings {
  const defaults = createDefaultSettings();
  if (!isRecord(raw)) return defaults;

  const general = isRecord(raw.general) ? raw.general : {};
  const appearance = isRecord(raw.appearance) ? raw.appearance : {};
  const advanced = isRecord(raw.advanced) ? raw.advanced : {};
  const theme = appearance.theme;

  return {
    version: integerInRangeOrDefault(raw.version, 1, Number.MAX_SAFE_INTEGER, defaults.version),
    general: {
      autoStartOnLogin: booleanOrDefault(
        general.autoStartOnLogin,
        defaults.general.autoStartOnLogin,
      ),
      autoStartServersOnLaunch: booleanOrDefault(
        general.autoStartServersOnLaunch,
        defaults.general.autoStartServersOnLaunch,
      ),
      minimizeToTrayOnClose: booleanOrDefault(
        general.minimizeToTrayOnClose,
        defaults.general.minimizeToTrayOnClose,
      ),
      showWindowOnLaunch: booleanOrDefault(
        general.showWindowOnLaunch,
        defaults.general.showWindowOnLaunch,
      ),
    },
    appearance: {
      theme: isThemeMode(theme) ? theme : defaults.appearance.theme,
    },
    advanced: {
      logRetentionDays: integerInRangeOrDefault(
        advanced.logRetentionDays,
        0,
        365,
        defaults.advanced.logRetentionDays,
      ),
      enableAuditLogging: booleanOrDefault(
        advanced.enableAuditLogging,
        defaults.advanced.enableAuditLogging,
      ),
      sidecarPort: integerInRangeOrDefault(
        advanced.sidecarPort,
        1024,
        65535,
        defaults.advanced.sidecarPort,
      ),
    },
  };
}

class SettingsService {
  private dataDir = "";
  private filePath = "";
  private cache: Settings | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  init(dataDir: string) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, SETTINGS_FILE);

    let settings: Settings;
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        settings = mergeStoredSettings(JSON.parse(raw));
      } catch {
        settings = createDefaultSettings();
      }
    } else {
      settings = createDefaultSettings();
    }

    this.cache = settings;
    this.writeFile(settings);
    this.syncToDb(settings);
  }

  getSettings(): Settings {
    return this.cache ?? createDefaultSettings();
  }

  updateSettings(payload: SettingsUpdatePayload): Settings {
    const current = this.getSettings();
    const updated: Settings = {
      version: current.version,
      general: { ...current.general, ...payload.general },
      appearance: { ...current.appearance, ...payload.appearance },
      advanced: { ...current.advanced, ...payload.advanced },
    };
    this.cache = updated;
    this.writeFile(updated);
    this.syncToDb(updated);
    eventBus.emit("settings:changed", updated);
    return updated;
  }

  resetSettings(): Settings {
    const defaults = createDefaultSettings();
    this.cache = defaults;
    this.writeFile(defaults);
    this.syncToDb(defaults);
    eventBus.emit("settings:changed", defaults);
    return defaults;
  }

  cleanupOldLogs() {
    const settings = this.getSettings();
    if (settings.advanced.logRetentionDays <= 0) return;
    const cutoff = new Date(
      Date.now() - settings.advanced.logRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    run("DELETE FROM audit_logs WHERE timestamp < ?", [cutoff]);
  }

  startLogCleanupInterval() {
    this.cleanupOldLogs();
    this.cleanupTimer = setInterval(() => this.cleanupOldLogs(), CLEANUP_INTERVAL_MS);
  }

  stopLogCleanupInterval() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private writeFile(settings: Settings) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2) + "\n");
  }

  private syncToDb(settings: Settings) {
    const now = new Date().toISOString();
    const flat: [string, string][] = [
      ["general.autoStartOnLogin", JSON.stringify(settings.general.autoStartOnLogin)],
      [
        "general.autoStartServersOnLaunch",
        JSON.stringify(settings.general.autoStartServersOnLaunch),
      ],
      ["general.minimizeToTrayOnClose", JSON.stringify(settings.general.minimizeToTrayOnClose)],
      ["general.showWindowOnLaunch", JSON.stringify(settings.general.showWindowOnLaunch)],
      ["appearance.theme", JSON.stringify(settings.appearance.theme)],
      ["advanced.logRetentionDays", JSON.stringify(settings.advanced.logRetentionDays)],
      ["advanced.enableAuditLogging", JSON.stringify(settings.advanced.enableAuditLogging)],
      ["advanced.sidecarPort", JSON.stringify(settings.advanced.sidecarPort)],
    ];
    transaction(() => {
      const stmt = getDb().prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
      );
      for (const [key, value] of flat) {
        stmt.run(key, value, now);
      }
    });
  }
}

export const settingsService = new SettingsService();
