import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { closeDb, initDb, queryAll, run, runMigrations } from "../db/index.js";
import { settings } from "../api/settings.js";
import { settingsService } from "./settings.js";
import { MCP_TIMEOUT_MS_DEFAULT, MCP_TIMEOUT_MS_MAX, MCP_TIMEOUT_MS_MIN } from "@moor/types";

let dataDir: string;

function insertAuditLog(id: string, timestamp: string) {
  run(
    `INSERT INTO audit_logs (id, timestamp, tool_name, arguments, result, duration_ms)
     VALUES (?, ?, 'tool', '{}', '{}', 1)`,
    [id, timestamp],
  );
}

function auditLogIds(): string[] {
  return queryAll("SELECT id FROM audit_logs ORDER BY id").map((row) => String(row.id));
}

async function patchSettings(body: unknown): Promise<Response> {
  return settings.request("/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("SettingsService", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-settings-"));
    await initDb({ dataDir });
    runMigrations();
    settingsService.init(dataDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    settingsService.stopLogCleanupInterval();
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("deep-merges partial settings files with defaults", async () => {
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-settings-"));
    writeFileSync(
      path.join(dataDir, "settings.json"),
      JSON.stringify({ general: { minimizeToTrayOnClose: false } }),
    );
    await initDb({ dataDir });
    runMigrations();

    settingsService.init(dataDir);

    expect(settingsService.getSettings()).toMatchObject({
      general: {
        autoStartOnLogin: false,
        autoStartServersOnLaunch: false,
        minimizeToTrayOnClose: false,
        showWindowOnLaunch: true,
      },
      appearance: { theme: "system" },
      advanced: {
        logRetentionDays: 30,
        enableAuditLogging: true,
        sidecarPort: 9223,
        mcpRequestTimeoutMs: 30_000,
        mcpServerStartTimeoutMs: 30_000,
      },
    });
  });

  it("persists settings to the database before updateSettings returns", () => {
    const updated = settingsService.updateSettings({
      general: { minimizeToTrayOnClose: false },
    });

    const rows = queryAll(
      "SELECT key, value FROM settings WHERE key = 'general.minimizeToTrayOnClose'",
    );
    expect(rows).toEqual([{ key: "general.minimizeToTrayOnClose", value: "false" }]);
    expect(updated.general.minimizeToTrayOnClose).toBe(false);
  });

  it("persists MCP timeout settings to the database", () => {
    const updated = settingsService.updateSettings({
      advanced: {
        mcpRequestTimeoutMs: 45_000,
        mcpServerStartTimeoutMs: 60_000,
      },
    });

    const rows = queryAll(
      "SELECT key, value FROM settings WHERE key IN ('advanced.mcpRequestTimeoutMs', 'advanced.mcpServerStartTimeoutMs') ORDER BY key",
    );
    expect(rows).toEqual([
      { key: "advanced.mcpRequestTimeoutMs", value: "45000" },
      { key: "advanced.mcpServerStartTimeoutMs", value: "60000" },
    ]);
    expect(updated.advanced.mcpRequestTimeoutMs).toBe(45_000);
    expect(updated.advanced.mcpServerStartTimeoutMs).toBe(60_000);
  });

  it("falls back and warns when stored MCP timeout settings are outside the supported range", async () => {
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-settings-"));
    writeFileSync(
      path.join(dataDir, "settings.json"),
      JSON.stringify({
        advanced: {
          mcpRequestTimeoutMs: MCP_TIMEOUT_MS_MIN - 1,
          mcpServerStartTimeoutMs: MCP_TIMEOUT_MS_MAX + 1,
        },
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await initDb({ dataDir });
    runMigrations();

    settingsService.init(dataDir);

    expect(settingsService.getSettings().advanced).toMatchObject({
      mcpRequestTimeoutMs: MCP_TIMEOUT_MS_DEFAULT,
      mcpServerStartTimeoutMs: MCP_TIMEOUT_MS_DEFAULT,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("advanced.mcpRequestTimeoutMs"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("advanced.mcpServerStartTimeoutMs"));
  });

  it("falls back and warns when stored advanced integer settings are outside the supported range", async () => {
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-settings-"));
    writeFileSync(
      path.join(dataDir, "settings.json"),
      JSON.stringify({
        version: 0,
        advanced: {
          logRetentionDays: 366,
          sidecarPort: 80,
        },
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await initDb({ dataDir });
    runMigrations();

    settingsService.init(dataDir);

    expect(settingsService.getSettings()).toMatchObject({
      version: 1,
      advanced: {
        logRetentionDays: 30,
        sidecarPort: 9223,
      },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("version"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("advanced.logRetentionDays"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("advanced.sidecarPort"));
  });

  it("keeps audit logs when retention is unlimited", () => {
    insertAuditLog("old", "2000-01-01T00:00:00.000Z");
    settingsService.updateSettings({ advanced: { logRetentionDays: 0 } });

    settingsService.cleanupOldLogs();

    expect(auditLogIds()).toEqual(["old"]);
  });

  it("removes audit logs older than the configured retention window", () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    insertAuditLog("old", old);
    insertAuditLog("recent", recent);
    settingsService.updateSettings({ advanced: { logRetentionDays: 30 } });

    settingsService.cleanupOldLogs();

    expect(auditLogIds()).toEqual(["recent"]);
  });
});

describe("settings API validation", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-settings-api-"));
    await initDb({ dataDir });
    runMigrations();
    settingsService.init(dataDir);
  });

  afterEach(() => {
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects invalid settings values", async () => {
    const invalidTheme = await patchSettings({ appearance: { theme: "sepia" } });
    expect(invalidTheme.status).toBe(400);
    await expect(invalidTheme.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("appearance.theme") },
    });

    const invalidPort = await patchSettings({ advanced: { sidecarPort: 80 } });
    expect(invalidPort.status).toBe(400);
    await expect(invalidPort.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("advanced.sidecarPort") },
    });

    const invalidRequestTimeout = await patchSettings({
      advanced: { mcpRequestTimeoutMs: 4_999 },
    });
    expect(invalidRequestTimeout.status).toBe(400);
    await expect(invalidRequestTimeout.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("advanced.mcpRequestTimeoutMs"),
      },
    });

    const invalidStartTimeout = await patchSettings({
      advanced: { mcpServerStartTimeoutMs: 300_001 },
    });
    expect(invalidStartTimeout.status).toBe(400);
    await expect(invalidStartTimeout.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("advanced.mcpServerStartTimeoutMs"),
      },
    });
  });

  it("rejects unknown settings fields", async () => {
    const response = await patchSettings({ advanced: { logRetentionDays: 30, extra: true } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("advanced") },
    });
  });

  it("accepts an empty patch as a no-op", async () => {
    const response = await patchSettings({});

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject(settingsService.getSettings());
  });

  it("rejects invalid JSON with 400", async () => {
    const response = await settings.request("/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid JSON" },
    });
  });
});
