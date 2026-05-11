import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { closeDb, initDb, queryAll, run, runMigrations } from "../db/index.js";
import { eventBus } from "../services/event-bus.js";
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
    eventBus.removeAll();
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
      error: {
        code: "ORDER_INVALID",
        message: "Server order must include every existing server exactly once.",
      },
    });
    expect(serverIds()).toEqual(original);

    const incomplete = await putOrder([second.id]);
    expect(incomplete.status).toBe(400);
    await expect(incomplete.json()).resolves.toEqual({
      error: {
        code: "ORDER_INVALID",
        message: "Server order must include every existing server exactly once.",
      },
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

  it("returns, stores, and emits public start errors without leaking searched PATH", async () => {
    const publicMessage =
      'Command "definitely-missing-moor-command" was not found. Configure an absolute command path or update this server environment.';
    const server = serverManager.addServer({
      name: "missing-command",
      connectionType: "stdio",
      command: "definitely-missing-moor-command",
    });
    const emitted: unknown[] = [];
    const unsubscribe = eventBus.on("server:status", (_event, data) => emitted.push(data));

    const response = await servers.request(`/${server.id}/start`, { method: "POST" });
    unsubscribe();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: publicMessage,
      },
    });
    expect(JSON.stringify(emitted)).not.toContain("Moor searched PATH");
    expect(
      queryAll("SELECT status, error_message FROM mcp_servers WHERE id = ?", [server.id]),
    ).toEqual([{ status: "error", error_message: publicMessage }]);
    expect(emitted).toContainEqual({
      type: "server:status",
      data: {
        serverId: server.id,
        status: "error",
        errorMessage: publicMessage,
      },
    });
  });

  it("returns pure server payloads for create and update list-cache mutations", async () => {
    const createResponse = await servers.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "created",
        connectionType: "stdio",
        command: "node",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created).toMatchObject({
      name: "created",
      connectionType: "stdio",
      command: "node",
    });
    expect(created).not.toHaveProperty("runtime");

    const updateResponse = await servers.request(`/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "updated" }),
    });

    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json();
    expect(updated).toMatchObject({ id: created.id, name: "updated" });
    expect(updated).not.toHaveProperty("runtime");

    const detailResponse = await servers.request(`/${created.id}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(detail.runtime).toMatchObject({ id: created.id, name: "updated" });
  });
});
