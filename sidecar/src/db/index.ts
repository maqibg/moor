import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export interface InitDbOptions {
  dataDir?: string;
  legacyDataDir?: string;
}

const DEFAULT_DATA_DIR = path.join(os.homedir(), ".moor");
const SQLITE_DATA_FILES = ["moor.db", "moor.db-wal", "moor.db-shm"] as const;

let sqlDb: DatabaseSync | null = null;
let dbPath = path.join(DEFAULT_DATA_DIR, "moor.db");

export interface LegacyDataDirMigrationOptions {
  dataDir: string;
  legacyDataDir?: string;
}

function normalizeParams(params: unknown[]): (string | number | null | bigint | Uint8Array)[] {
  return params.map((param) => {
    if (param === undefined) return null;
    if (
      typeof param === "string" ||
      typeof param === "number" ||
      typeof param === "bigint" ||
      param === null ||
      param instanceof Uint8Array
    ) {
      return param;
    }
    return JSON.stringify(param);
  });
}

export async function initDb(options: InitDbOptions = {}) {
  const dataDir = options.dataDir ?? process.env.MOOR_DATA_DIR ?? DEFAULT_DATA_DIR;
  migrateLegacyDataDir({ dataDir, legacyDataDir: options.legacyDataDir });
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, "moor.db");
  sqlDb = new DatabaseSync(dbPath);
  sqlDb.exec("PRAGMA foreign_keys = ON");
  sqlDb.exec("PRAGMA journal_mode = WAL");
  sqlDb.exec("PRAGMA busy_timeout = 5000");
  return sqlDb;
}

export function migrateLegacyDataDir(options: LegacyDataDirMigrationOptions) {
  const { dataDir, legacyDataDir } = options;
  if (!legacyDataDir || path.resolve(dataDir) === path.resolve(legacyDataDir)) return;

  const currentDbPath = path.join(dataDir, "moor.db");
  if (fs.existsSync(currentDbPath)) return;

  const legacyDbPath = path.join(legacyDataDir, "moor.db");
  if (!fs.existsSync(legacyDbPath)) return;

  fs.mkdirSync(dataDir, { recursive: true });
  for (const fileName of SQLITE_DATA_FILES) {
    const source = path.join(legacyDataDir, fileName);
    const target = path.join(dataDir, fileName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, target);
    }
  }
}

export function getDb(): DatabaseSync {
  if (!sqlDb) throw new Error("Database not initialized");
  return sqlDb;
}

export function runMigrations() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL CHECK(connection_type IN ('stdio', 'http')),
      command TEXT,
      args TEXT,
      url TEXT,
      env TEXT,
      headers TEXT,
      working_dir TEXT,
      status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('stopped', 'starting', 'running', 'error')),
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_servers (
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1,
      disabled_tools TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (profile_id, server_id)
    );

    CREATE TABLE IF NOT EXISTS tool_discoveries (
      server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      exposed_name TEXT NOT NULL,
      description TEXT,
      input_schema TEXT,
      discovered_at TEXT NOT NULL,
      PRIMARY KEY (server_id, tool_name)
    );

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

    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tool_name ON audit_logs(tool_name);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_server_id ON audit_logs(server_id);
    CREATE INDEX IF NOT EXISTS idx_tool_discoveries_server_id ON tool_discoveries(server_id);
    CREATE INDEX IF NOT EXISTS idx_tool_discoveries_exposed_name ON tool_discoveries(exposed_name);
  `);

  ensureColumn("tool_discoveries", "exposed_name", "TEXT");
  ensureColumn("mcp_servers", "headers", "TEXT");
}

function ensureColumn(table: string, column: string, definition: string) {
  const exists = queryAll(`PRAGMA table_info(${table})`).some((row) => row.name === column);
  if (!exists) run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function seedDefaultProfile() {
  const rows = queryAll("SELECT id FROM profiles WHERE name = 'Default'", []);
  const now = new Date().toISOString();
  run("UPDATE profiles SET is_active = 0", []);
  if (rows.length === 0) {
    run(
      "INSERT INTO profiles (id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
      [crypto.randomUUID(), "Default", now, now],
    );
  } else {
    run("UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?", [now, rows[0].id]);
  }
}

export function run(sql: string, params: unknown[] = []) {
  getDb()
    .prepare(sql)
    .run(...normalizeParams(params));
}

export function exec(sql: string) {
  getDb().exec(sql);
}

export function transaction<T>(callback: () => T): T {
  exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    exec("COMMIT");
    return result;
  } catch (err) {
    exec("ROLLBACK");
    throw err;
  }
}

export function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  return getDb()
    .prepare(sql)
    .all(...normalizeParams(params)) as Record<string, unknown>[];
}

export function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const row = getDb()
    .prepare(sql)
    .get(...normalizeParams(params));
  return row ? (row as Record<string, unknown>) : null;
}

export function closeDb() {
  if (sqlDb) {
    sqlDb.close();
    sqlDb = null;
  }
}

export function getDbPath() {
  return dbPath;
}
