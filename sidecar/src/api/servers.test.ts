import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { closeDb, initDb, queryAll, run, runMigrations } from "../db/index.js";
import { profileService } from "../services/profiles.js";
import { serverManager } from "../services/server-manager.js";
import { servers } from "./servers.js";

let dataDir: string;

function serverIds(): string[] {
  return queryAll("SELECT id FROM mcp_servers ORDER BY sort_order ASC, created_at DESC").map(
    (row) => String(row.id),
  );
}

async function putOrder(serverIds: string[]): Promise<Response> {
  return servers.request("/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverIds }),
  });
}

describe("servers API ordering", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-servers-api-"));
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

  it("persists a complete server reorder and returns the sorted list", async () => {
    const first = serverManager.addServer({
      name: "first",
      connectionType: "stdio",
      command: "node",
    });
    const second = serverManager.addServer({
      name: "second",
      connectionType: "stdio",
      command: "node",
    });
    const third = serverManager.addServer({
      name: "third",
      connectionType: "stdio",
      command: "node",
    });

    const response = await putOrder([second.id, first.id, third.id]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject([
      { id: second.id },
      { id: first.id },
      { id: third.id },
    ]);
    expect(serverIds()).toEqual([second.id, first.id, third.id]);
  });

  it("rejects duplicate or incomplete server order payloads without partial writes", async () => {
    const first = serverManager.addServer({
      name: "first",
      connectionType: "stdio",
      command: "node",
    });
    const second = serverManager.addServer({
      name: "second",
      connectionType: "stdio",
      command: "node",
    });
    const original = serverIds();

    const duplicate = await putOrder([first.id, first.id]);
    expect(duplicate.status).toBe(400);
    await expect(duplicate.json()).resolves.toEqual({
      error: "Server order must include every existing server exactly once.",
    });
    expect(serverIds()).toEqual(original);

    const incomplete = await putOrder([second.id]);
    expect(incomplete.status).toBe(400);
    await expect(incomplete.json()).resolves.toEqual({
      error: "Server order must include every existing server exactly once.",
    });
    expect(serverIds()).toEqual(original);
  });

  it("allows deleting a server that has profile, tool, and audit log references", async () => {
    const server = serverManager.addServer({
      name: "delete-me",
      connectionType: "stdio",
      command: "node",
    });
    profileService.assignToActiveProfile([server.id]);
    serverManager.cacheTools(server.id, [{ name: "echo" }]);
    run(
      `INSERT INTO audit_logs (id, timestamp, server_id, tool_name)
       VALUES ('audit-1', '2026-01-01T00:00:00.000Z', ?, 'echo')`,
      [server.id],
    );

    const response = await servers.request(`/${server.id}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(queryAll("SELECT id FROM mcp_servers WHERE id = ?", [server.id])).toEqual([]);
    expect(
      queryAll("SELECT server_id FROM profile_servers WHERE server_id = ?", [server.id]),
    ).toEqual([]);
    expect(
      queryAll("SELECT server_id FROM tool_discoveries WHERE server_id = ?", [server.id]),
    ).toEqual([]);
    expect(queryAll("SELECT id, server_id FROM audit_logs")).toEqual([
      { id: "audit-1", server_id: null },
    ]);
  });
});
