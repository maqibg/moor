import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  closeDb,
  exec,
  initDb,
  queryAll,
  queryOne,
  run,
  runMigrations,
  type Database,
} from "./index.js";
import { AuditLogRepository } from "./audit-log-repository.js";
import { ProfileRepository } from "./profile-repository.js";
import { ServerRepository } from "./server-repository.js";
import { ToolDiscoveryRepository } from "./tool-discovery-repository.js";

let dataDir: string;

function insertServer(
  repo: ServerRepository,
  overrides: Partial<Parameters<ServerRepository["insert"]>[0]> = {},
) {
  const now = "2026-01-01T00:00:00.000Z";
  repo.insert({
    id: "server-1",
    name: "Server 1",
    connectionType: "stdio",
    command: "node",
    args: null,
    url: null,
    env: null,
    headers: null,
    workingDir: null,
    autoStart: 0,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function insertAuditLog(
  repo: AuditLogRepository,
  overrides: Partial<Parameters<AuditLogRepository["insert"]>[0]> = {},
) {
  repo.insert({
    id: "audit-1",
    timestamp: "2026-01-01T00:00:00.000Z",
    profileId: null,
    serverId: null,
    toolName: "echo",
    arguments: {},
    result: null,
    error: null,
    durationMs: 10,
    agentInfo: null,
    ...overrides,
  });
}

function serverRow(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    connection_type: "stdio",
    command: "node",
    args: null,
    url: null,
    env: null,
    headers: null,
    working_dir: null,
    auto_start: 0,
    sort_order: 0,
    status: "stopped",
    error_message: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("repository layer", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-repositories-"));
    await initDb({ dataDir });
    runMigrations();
  });

  afterEach(() => {
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("lists servers without materializing discovered tool summaries", () => {
    const repo = new ServerRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });
    insertServer(repo);
    run(
      `INSERT INTO tool_discoveries (server_id, tool_name, exposed_name, discovered_at)
       VALUES ('server-1', 'echo', 'echo', '2026-01-01T00:00:00.000Z')`,
    );

    const rows = repo.findAll();

    expect(rows).toHaveLength(1);
    expect(Object.hasOwn(rows[0], "tools")).toBe(false);
  });

  it("returns lightweight server names for import duplicate checks", () => {
    const repo = new ServerRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });
    insertServer(repo, { id: "server-1", name: "GitHub", command: "npx" });
    insertServer(repo, { id: "server-2", name: "Linear", command: "uvx", sortOrder: 1 });

    const rows = (
      repo as ServerRepository & { findAllNames(): Array<Record<string, unknown>> }
    ).findAllNames();

    expect(rows).toEqual([
      { id: "server-1", name: "GitHub" },
      { id: "server-2", name: "Linear" },
    ]);
    expect(rows[0]).not.toHaveProperty("command");
  });

  it("chunks server batch lookups while preserving requested order and duplicates", () => {
    const queryParams: unknown[][] = [];
    const repo = new ServerRepository({
      run: () => undefined,
      exec: () => undefined,
      queryAll: (_sql, params = []) => {
        queryParams.push(params);
        return params.map((id) => serverRow(String(id)));
      },
      queryOne: () => null,
      transaction: (callback) => callback(),
    });
    const ids = Array.from({ length: 501 }, (_, index) => `server-${index}`);
    const requested = [ids[500], ...ids, ids[500]];

    const rows = repo.findByIds(requested);

    expect(queryParams).toHaveLength(2);
    expect(queryParams[0]).toHaveLength(500);
    expect(queryParams[1]).toHaveLength(1);
    expect(rows.map((row) => row.id)).toEqual(requested);
  });

  it("stores null audit arguments as SQL NULL instead of a JSON string", () => {
    const repo = new AuditLogRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });

    insertAuditLog(repo, { arguments: null, result: null });

    expect(queryOne("SELECT arguments, result FROM audit_logs WHERE id = 'audit-1'")).toEqual({
      arguments: null,
      result: null,
    });
  });

  it("excludes deleted-server audit rows from top server stats", () => {
    const serverRepo = new ServerRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });
    const repo = new AuditLogRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });
    insertServer(serverRepo);
    insertAuditLog(repo, { id: "audit-1", serverId: null, durationMs: 10 });
    insertAuditLog(repo, { id: "audit-2", serverId: null, durationMs: 20 });
    insertAuditLog(repo, { id: "audit-3", serverId: "server-1", durationMs: 30 });

    expect(repo.getStats()).toMatchObject({
      totalCalls: 3,
      errorCalls: 0,
      avgDurationMs: 20,
      topServers: [{ serverId: "server-1", count: 1 }],
    });
  });

  it("upserts profile server state through insert and update branches", () => {
    const serverRepo = new ServerRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });
    const profileRepo = new ProfileRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });
    insertServer(serverRepo);
    const profile = profileRepo.create("Work");

    expect(
      profileRepo.upsertProfileServer(profile.id, "server-1", {
        enabled: false,
        disabledTools: ["read_file"],
      }),
    ).toEqual({
      serverId: "server-1",
      enabled: false,
      disabledTools: ["read_file"],
    });

    expect(profileRepo.upsertProfileServer(profile.id, "server-1", { enabled: true })).toEqual({
      serverId: "server-1",
      enabled: true,
      disabledTools: ["read_file"],
    });
  });

  it("ignores malformed disabled tool JSON", () => {
    const serverRepo = new ServerRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });
    const profileRepo = new ProfileRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });
    const repo = new ToolDiscoveryRepository({
      run,
      exec: () => undefined,
      queryAll,
      queryOne,
      transaction: (callback) => callback(),
    });
    insertServer(serverRepo);
    const profile = profileRepo.create("Work");
    run(
      `INSERT INTO profile_servers (profile_id, server_id, enabled, disabled_tools)
       VALUES (?, 'server-1', 1, '{broken')`,
      [profile.id],
    );

    expect(repo.findDisabledToolsForServer(profile.id, "server-1")).toEqual(new Set());
  });

  it("throws if a profile cannot be reloaded after create or update", () => {
    const createDb: Database = {
      run: () => undefined,
      exec: () => undefined,
      queryAll: () => [],
      queryOne: () => null,
      transaction: (callback) => callback(),
    };
    expect(() => new ProfileRepository(createDb).create("Missing")).toThrow(
      "Created profile could not be reloaded",
    );

    let updateReads = 0;
    const updateDb: Database = {
      run: () => undefined,
      exec: () => undefined,
      queryAll: () => [],
      queryOne: () => (updateReads++ === 0 ? { id: "profile-1" } : null),
      transaction: (callback) => callback(),
    };
    expect(() => new ProfileRepository(updateDb).update("profile-1", { name: "Next" })).toThrow(
      "Updated profile could not be reloaded",
    );
  });

  it("rolls back server reorder writes when a later update fails", () => {
    const repo = new ServerRepository({
      run,
      exec: (sql) => run(sql),
      queryAll,
      queryOne,
      transaction: (callback) => {
        exec("BEGIN IMMEDIATE");
        try {
          const result = callback();
          exec("COMMIT");
          return result;
        } catch (err) {
          exec("ROLLBACK");
          throw err;
        }
      },
    });
    insertServer(repo, { id: "first", name: "First", sortOrder: 0 });
    insertServer(repo, { id: "second", name: "Second", sortOrder: 1 });
    insertServer(repo, { id: "third", name: "Third", sortOrder: 2 });
    run(
      `CREATE TRIGGER fail_second_reorder
       BEFORE UPDATE OF sort_order ON mcp_servers
       WHEN OLD.id = 'second'
       BEGIN
         SELECT RAISE(ABORT, 'blocked reorder');
       END`,
    );

    expect(() => repo.reorder(["third", "second", "first"])).toThrow("blocked reorder");
    expect(queryAll("SELECT id, sort_order FROM mcp_servers ORDER BY id ASC")).toEqual([
      { id: "first", sort_order: 0 },
      { id: "second", sort_order: 1 },
      { id: "third", sort_order: 2 },
    ]);
  });
});
