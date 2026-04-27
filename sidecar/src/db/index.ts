import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const DATA_DIR = path.join(os.homedir(), ".moor");
const DB_PATH = path.join(DATA_DIR, "moor.db");

let sqlDb: SqlJsDatabase;

export async function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }

  sqlDb.run("PRAGMA foreign_keys = ON");

  // Auto-save every 5 seconds
  const saveTimer = setInterval(saveDb, 5000);

  return sqlDb;
}

export function saveDb() {
  if (!sqlDb) return;
  const data = sqlDb.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

export function getDb(): SqlJsDatabase {
  return sqlDb;
}

export function runMigrations() {
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL CHECK(connection_type IN ('stdio', 'http')),
      command TEXT,
      args TEXT,
      url TEXT,
      env TEXT,
      working_dir TEXT,
      status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('stopped', 'starting', 'running', 'error')),
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS profile_servers (
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1,
      disabled_tools TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (profile_id, server_id)
    );
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS tool_discoveries (
      server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      description TEXT,
      input_schema TEXT,
      discovered_at TEXT NOT NULL
    );
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      profile_id TEXT REFERENCES profiles(id),
      server_id TEXT REFERENCES mcp_servers(id),
      tool_name TEXT NOT NULL,
      arguments TEXT,
      result TEXT,
      error TEXT,
      duration_ms INTEGER,
      agent_info TEXT
    );
  `);

  sqlDb.run("CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)");
  sqlDb.run("CREATE INDEX IF NOT EXISTS idx_audit_logs_tool_name ON audit_logs(tool_name)");
  sqlDb.run("CREATE INDEX IF NOT EXISTS idx_audit_logs_server_id ON audit_logs(server_id)");
  sqlDb.run("CREATE INDEX IF NOT EXISTS idx_tool_discoveries_server_id ON tool_discoveries(server_id)");

  saveDb();
}

export function seedDefaultProfile() {
  const rows = queryAll("SELECT id FROM profiles WHERE name = 'Default'", []);
  if (rows.length === 0) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    run("INSERT INTO profiles (id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)", [id, "Default", now, now]);
  } else {
    run("UPDATE profiles SET is_active = 1 WHERE id = ?", [rows[0].id]);
  }
}

export function run(sql: string, params: unknown[] = []) {
  sqlDb.run(sql, params);
}

export function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = sqlDb.prepare(sql);
  stmt.bind(params as (string | number | null | Uint8Array)[]);
  const results: Record<string, unknown>[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

export function closeDb() {
  if (sqlDb) {
    saveDb();
    sqlDb.close();
  }
}
