import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  closeDb,
  initDb,
  queryAll,
  queryOne,
  run,
  runMigrations,
  seedDefaultProfile,
} from "../db/index.js";
import { resolveHttpHeaders, serverManager } from "./server-manager.js";

const fixturePath = path.join(process.cwd(), "src/test/fixtures/stdio-echo-server.mjs");
let dataDir: string;

describe("ServerManager MCP lifecycle", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-test-"));
    await initDb({ dataDir });
    runMigrations();
    seedDefaultProfile();
    serverManager.resetForTest();
    serverManager.loadFromDb();
  });

  afterEach(async () => {
    await serverManager.stopAll();
    serverManager.resetForTest();
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("initializes stdio servers, caches tools, and reuses the client for calls", async () => {
    const managed = serverManager.addServer({
      name: "Echo Fixture",
      connectionType: "stdio",
      command: process.execPath,
      args: [fixturePath],
    });
    const profile = queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
    run(
      "INSERT INTO profile_servers (profile_id, server_id, enabled, disabled_tools) VALUES (?, ?, 1, '[]')",
      [profile?.id, managed.id],
    );

    await serverManager.startServer(managed.id);

    expect(
      queryAll("SELECT tool_name FROM tool_discoveries WHERE server_id = ?", [managed.id]),
    ).toEqual([{ tool_name: "echo" }]);
    await expect(
      serverManager.callToolByExposedName("echo", { message: "hello" }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("resolves env placeholders for HTTP transport headers", () => {
    process.env.MOOR_TEST_HEADER_TOKEN = "secret-token";

    expect(
      resolveHttpHeaders({
        Authorization: "Bearer {env:MOOR_TEST_HEADER_TOKEN}",
        "X-Static": "static",
        "X-Missing": "{env:MOOR_TEST_MISSING}",
      }),
    ).toEqual({
      Authorization: "Bearer secret-token",
      "X-Static": "static",
    });

    delete process.env.MOOR_TEST_HEADER_TOKEN;
  });
});
