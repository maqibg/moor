import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import {
  assertStdioCommandAvailable,
  buildStdioEnvironment,
  findExecutableOnPath,
  resolveHttpHeaders,
  serverManager,
} from "./server-manager.js";

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

  it("builds a stdio environment with common macOS CLI paths for GUI launches", () => {
    const home = mkdtempSync(path.join(tmpdir(), "moor-home-"));
    try {
      const env = buildStdioEnvironment({
        HOME: home,
        PATH: ["/usr/bin", "/bin", "/usr/bin"].join(path.delimiter),
        MOOR_IGNORED: 1,
      });
      const pathEntries = env.PATH.split(path.delimiter);

      expect(pathEntries.filter((entry) => entry === "/usr/bin")).toHaveLength(1);
      expect(pathEntries).toContain(path.join(home, ".local", "share", "mise", "shims"));
      expect(pathEntries).toContain(path.join(home, ".local", "bin"));
      expect(pathEntries).toContain(path.join(home, "Library", "pnpm"));
      expect(pathEntries).toContain("/opt/homebrew/bin");
      expect(env.MOOR_IGNORED).toBeUndefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps server PATH entries before process PATH entries", () => {
    const env = buildStdioEnvironment(
      {
        HOME: "/Users/tester",
        PATH: ["/usr/bin", "/bin"].join(path.delimiter),
      },
      {
        PATH: ["/custom/bin", "/usr/bin"].join(path.delimiter),
        TOKEN: "secret",
        IGNORED_FLAG: false,
      },
    );

    expect(env.PATH.split(path.delimiter).slice(0, 3)).toEqual(["/custom/bin", "/usr/bin", "/bin"]);
    expect(env.TOKEN).toBe("secret");
    expect(env.IGNORED_FLAG).toBeUndefined();
  });

  it("finds executable commands on the constructed PATH", () => {
    const binDir = mkdtempSync(path.join(tmpdir(), "moor-bin-"));
    try {
      const commandPath = path.join(binDir, "sample-tool");
      writeFileSync(commandPath, "#!/bin/sh\nexit 0\n");
      chmodSync(commandPath, 0o755);

      expect(findExecutableOnPath("sample-tool", { PATH: binDir })).toBe(commandPath);
      expect(findExecutableOnPath(commandPath, { PATH: "/definitely/missing" })).toBe(commandPath);
      expect(() =>
        assertStdioCommandAvailable(commandPath, { PATH: "/definitely/missing" }),
      ).not.toThrow();
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("reports an actionable error when a bare stdio command is missing", () => {
    expect(() =>
      assertStdioCommandAvailable("npx", {
        PATH: ["/definitely/missing", "/also/missing"].join(path.delimiter),
      }),
    ).toThrow(
      /Command "npx" was not found.*Moor searched PATH.*absolute command path.*server environment/s,
    );
  });

  it("reports an actionable error when an absolute stdio command is missing", () => {
    expect(() =>
      assertStdioCommandAvailable("/definitely/missing/npx", {
        PATH: "/definitely/missing",
      }),
    ).toThrow(/Command "\/definitely\/missing\/npx" is not executable.*absolute path/s);
  });
});
