import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { closeDb, initDb, queryAll, run, runMigrations } from "../db/index.js";
import { settings } from "../api/settings.js";
import { settingsService } from "./settings.js";

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
      },
    });
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
