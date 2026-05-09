import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { closeDb, exec, initDb, queryAll, runMigrations } from "./index.js";

let dataDir: string;

describe("server ordering migrations", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-server-order-"));
    await initDb({ dataDir });
  });

  afterEach(() => {
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("backfills existing servers by newest-created first when sort_order is introduced", () => {
    exec(`
      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        connection_type TEXT NOT NULL CHECK(connection_type IN ('stdio', 'http')),
        command TEXT,
        args TEXT,
        url TEXT,
        env TEXT,
        headers TEXT,
        working_dir TEXT,
        auto_start INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('stopped', 'starting', 'running', 'error')),
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    exec(`
      INSERT INTO mcp_servers (id, name, connection_type, command, created_at, updated_at)
      VALUES
        ('old', 'old', 'stdio', 'node', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('new', 'new', 'stdio', 'node', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
        ('middle', 'middle', 'stdio', 'node', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    `);

    runMigrations();

    expect(queryAll("SELECT id, sort_order FROM mcp_servers ORDER BY sort_order ASC")).toEqual([
      { id: "new", sort_order: 0 },
      { id: "middle", sort_order: 1 },
      { id: "old", sort_order: 2 },
    ]);
  });
});
