import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { closeDb, initDb, queryAll, queryOne, run, runMigrations } from "../db/index.js";
import { profileService } from "./profiles.js";
import { getServerRepository } from "../db/server-repository.js";
import {
  assertStdioCommandAvailable,
  buildStdioEnvironment,
  findExecutableOnPath,
} from "./stdio-env.js";
import { resolveHttpHeaders } from "./http-headers.js";
import { type ManagedServer, ServerRuntime, serverManager } from "./server-manager.js";
import type { Server } from "@moor/types";

const fixturePath = fileURLToPath(
  new URL("../test/fixtures/stdio-echo-server.mjs", import.meta.url),
);
let dataDir: string;

interface TestManager {
  cacheTools: typeof serverManager.cacheTools;
  getToolDetails: typeof serverManager.getToolDetails;
  getToolCatalog: typeof serverManager.getToolCatalog;
  getServer: typeof serverManager.getServer;
  loadFromDb: typeof serverManager.loadFromDb;
  startAutoStartServers: typeof serverManager.startAutoStartServers;
  startServer: typeof serverManager.startServer;
  stopServer: typeof serverManager.stopServer;
  stopAll: typeof serverManager.stopAll;
  registerServer: typeof serverManager.registerServer;
  unregisterServer: typeof serverManager.unregisterServer;
}

type TestSessionFactory = NonNullable<ConstructorParameters<typeof ServerRuntime>[0]>;
type TestServerSession = Awaited<ReturnType<TestSessionFactory>>;

function createFakeSession(
  onClose: () => void = () => undefined,
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [],
): TestServerSession {
  return {
    client: {
      listTools: async () => ({ tools }),
      close: async () => {
        onClose();
      },
    },
    transport: {},
  } as unknown as TestServerSession;
}

function createTestManager(sessionFactory: TestSessionFactory): TestManager {
  const manager = new ServerRuntime(sessionFactory);
  manager.loadFromDb();
  return manager;
}

function addServerToActiveProfile(server: Server | ManagedServer) {
  const profile = queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
  run(
    "INSERT OR IGNORE INTO profile_servers (profile_id, server_id, enabled, disabled_tools) VALUES (?, ?, 1, '[]')",
    [profile?.id, server.id],
  );
}

function addAutoStartServer(manager: TestManager, name: string): ManagedServer {
  const repo = getServerRepository();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  repo.insert({
    id,
    name,
    connectionType: "stdio",
    command: process.execPath,
    args: null,
    url: null,
    env: null,
    headers: null,
    workingDir: null,
    autoStart: 1,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });
  const created = repo.findById(id)!;
  manager.registerServer(id);
  addServerToActiveProfile(created);
  return manager.getServer(id)!;
}

function setAutoStartOrder(manager: TestManager, servers: ManagedServer[]) {
  (
    manager as unknown as { autoStartEligibleServers: () => ManagedServer[] }
  ).autoStartEligibleServers = () => servers;
}

describe("ServerManager MCP lifecycle", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-test-"));
    await initDb({ dataDir });
    runMigrations();
    profileService.seedDefault();
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
    const server = serverManager.addServer({
      name: "Echo Fixture",
      connectionType: "stdio",
      command: process.execPath,
      args: [fixturePath],
    });
    serverManager.registerServer(server.id);
    addServerToActiveProfile(server);

    await serverManager.startServer(server.id);

    expect(
      queryAll("SELECT tool_name FROM tool_discoveries WHERE server_id = ?", [server.id]),
    ).toEqual([{ tool_name: "echo" }]);
    await expect(
      serverManager.callToolByExposedName("echo_fixture__echo", { message: "hello" }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "hello" }],
    });

    await serverManager.stopServer(server.id);

    expect(
      queryAll("SELECT tool_name FROM tool_discoveries WHERE server_id = ?", [server.id]),
    ).toEqual([{ tool_name: "echo" }]);
    expect(serverManager.getToolCatalog()).toEqual([]);
    expect(serverManager.findToolOwner("echo_fixture__echo")).toBeNull();
  });

  it("ignores stopped servers before computing exposed tool names", async () => {
    const manager = createTestManager(async () =>
      createFakeSession(() => undefined, [{ name: "search" }]),
    );
    const running = addAutoStartServer(manager, "Visible");
    const stopped = addAutoStartServer(manager, "Hidden");
    manager.cacheTools(stopped.id, [{ name: "search" }]);

    await manager.startServer(running.id);

    expect(manager.getServer(running.id)?.status).toBe("running");
    expect(manager.getServer(stopped.id)?.status).toBe("stopped");
    expect(manager.getToolCatalog().map((tool) => tool.exposedName)).toEqual(["visible__search"]);
    expect(manager.getToolDetails(running.id).map((tool) => tool.exposedName)).toEqual([
      "visible__search",
    ]);
    expect(manager.getToolDetails(stopped.id).map((tool) => tool.exposedName)).toEqual([
      "hidden__search",
    ]);
  });

  it("keeps the server slug for disabled server tool details", () => {
    const manager = createTestManager(async () => createFakeSession());
    const disabled = addAutoStartServer(manager, "Hidden");
    manager.cacheTools(disabled.id, [{ name: "search" }]);
    run("UPDATE profile_servers SET enabled = 0 WHERE server_id = ?", [disabled.id]);

    expect(manager.getToolDetails(disabled.id).map((tool) => tool.exposedName)).toEqual([
      "hidden__search",
    ]);
  });

  it("reuses the in-flight start when a server is already starting", async () => {
    let releaseStart: () => void = () => undefined;
    const pendingStart = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const startCalls: string[] = [];
    const manager = createTestManager(async (config) => {
      startCalls.push(config.name);
      await pendingStart;
      return createFakeSession();
    });
    const server = serverManager.addServer({
      name: "Slow Fixture",
      connectionType: "stdio",
      command: process.execPath,
      autoStart: true,
    });
    manager.registerServer(server.id);
    addServerToActiveProfile(server);
    const managed = manager.getServer(server.id)!;

    const firstStart = manager.startServer(managed.id);
    expect(startCalls).toEqual(["Slow Fixture"]);
    expect(manager.getServer(managed.id)?.status).toBe("starting");

    const secondStart = manager.startServer(managed.id);
    expect(startCalls).toEqual(["Slow Fixture"]);

    releaseStart();
    await Promise.all([firstStart, secondStart]);
    expect(startCalls).toEqual(["Slow Fixture"]);
  });

  it("starts auto-start servers concurrently so a pending server does not block later servers", async () => {
    let releaseSlowStart: () => void = () => undefined;
    const pendingSlowStart = new Promise<void>((resolve) => {
      releaseSlowStart = resolve;
    });
    const startCalls: string[] = [];
    const manager = createTestManager(async (config) => {
      startCalls.push(config.name);
      if (config.name === "Slow Fixture") {
        await pendingSlowStart;
      }
      return createFakeSession();
    });
    const slow = addAutoStartServer(manager, "Slow Fixture");
    const fast = addAutoStartServer(manager, "Fast Fixture");
    setAutoStartOrder(manager, [slow, fast]);

    const autoStart = manager.startAutoStartServers();
    await Promise.resolve();

    expect(startCalls).toEqual(["Slow Fixture", "Fast Fixture"]);

    releaseSlowStart();
    await autoStart;
  });

  it("continues auto-starting remaining servers when one server fails", async () => {
    const startCalls: string[] = [];
    const manager = createTestManager(async (config) => {
      startCalls.push(config.name);
      if (config.name === "Broken Fixture") {
        throw new Error("fixture failed");
      }
      return createFakeSession();
    });
    const broken = addAutoStartServer(manager, "Broken Fixture");
    const healthy = addAutoStartServer(manager, "Healthy Fixture");
    setAutoStartOrder(manager, [broken, healthy]);

    await manager.startAutoStartServers();

    expect(startCalls).toEqual(expect.arrayContaining(["Broken Fixture", "Healthy Fixture"]));
    expect(startCalls).toHaveLength(2);
    expect(manager.getServer(broken.id)?.status).toBe("error");
    expect(manager.getServer(healthy.id)?.status).toBe("running");
  });

  it("stops a running server before removing it", async () => {
    let closeCalls = 0;
    const manager = createTestManager(async () => createFakeSession(() => closeCalls++));
    const managed = addAutoStartServer(manager, "Running Fixture");

    await manager.startServer(managed.id);
    expect(manager.getServer(managed.id)?.status).toBe("running");

    await manager.stopServer(managed.id);
    getServerRepository().remove(managed.id);
    manager.unregisterServer(managed.id);

    expect(closeCalls).toBe(1);
    expect(manager.getServer(managed.id)).toBeUndefined();
    expect(queryOne("SELECT id FROM mcp_servers WHERE id = ?", [managed.id])).toBeNull();
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
