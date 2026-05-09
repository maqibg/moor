import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { closeDb, initDb, runMigrations } from "../db/index.js";
import { getServerRepository } from "../db/server-repository.js";
import { serverManager } from "../services/server-manager.js";
import { convertConfig } from "./converter.js";

let dataDir: string;

describe("convertConfig Moor source", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-converter-"));
    await initDb({ dataDir });
    runMigrations();
    serverManager.resetForTest();
    serverManager.loadFromDb();
  });

  afterEach(() => {
    serverManager.resetForTest();
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("converts selected Moor servers in the requested order", () => {
    const first = serverManager.addServer({
      name: "first",
      connectionType: "stdio",
      command: "node",
      args: ["first.js"],
      env: { FIRST: "1" },
      workingDir: "/tmp/first",
    });
    const second = serverManager.addServer({
      name: "second",
      connectionType: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer ${TOKEN}" },
    });

    const result = convertConfig({
      source: "moor",
      serverIds: [second.id, first.id],
      targetClient: "cursor",
    });
    const parsed = JSON.parse(result.content);

    expect(Object.keys(parsed.mcpServers)).toEqual(["second", "first"]);
    expect(parsed.mcpServers.second).toEqual({
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer ${env:TOKEN}" },
    });
    expect(parsed.mcpServers.first).toEqual({
      type: "stdio",
      command: "node",
      args: ["first.js"],
      env: { FIRST: "1" },
    });
  });

  it("loads selected Moor servers through a batch lookup preserving requested order", () => {
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

    const rows = getServerRepository().findByIds([second.id, "missing", first.id]);

    expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
  });
});
