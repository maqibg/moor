import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export interface InitDbOptions {
  dataDir?: string;
  legacyDataDir?: string;
}

export interface Database {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): void;
  queryAll(sql: string, params?: unknown[]): Record<string, unknown>[];
  queryOne(sql: string, params?: unknown[]): Record<string, unknown> | null;
  transaction<T>(callback: () => T): T;
}

const DEFAULT_DATA_DIR = path.join(os.homedir(), ".moor");
const SQLITE_DATA_FILES = ["moor.db", "moor.db-wal", "moor.db-shm"] as const;

let sqlDb: DatabaseSync | null = null;
let db: Database | null = null;
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

  db = createDatabaseAdapter(sqlDb);
  return db;
}

function createDatabaseAdapter(sqlite: DatabaseSync): Database {
  return {
    run(sql: string, params: unknown[] = []) {
      sqlite.prepare(sql).run(...normalizeParams(params));
    },
    exec(sql: string) {
      sqlite.exec(sql);
    },
    queryAll(sql: string, params: unknown[] = []) {
      return sqlite.prepare(sql).all(...normalizeParams(params)) as Record<string, unknown>[];
    },
    queryOne(sql: string, params: unknown[] = []) {
      const row = sqlite.prepare(sql).get(...normalizeParams(params));
      return row ? (row as Record<string, unknown>) : null;
    },
    transaction<T>(callback: () => T): T {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = callback();
        sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

export function getDatabase(): Database {
  if (!db) throw new Error("Database not initialized");
  return db;
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
      auto_start INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn("tool_discoveries", "exposed_name", "TEXT");
  ensureColumn("mcp_servers", "headers", "TEXT");
  ensureColumn("mcp_servers", "auto_start", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("mcp_servers", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  backfillServerSortOrder();
}

function ensureColumn(table: string, column: string, definition: string) {
  const exists = queryAll(`PRAGMA table_info(${table})`).some((row) => row.name === column);
  if (!exists) run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function backfillServerSortOrder() {
  const rows = queryAll("SELECT id, sort_order FROM mcp_servers ORDER BY created_at DESC, id ASC");
  if (rows.length <= 1) return;

  const sortOrders = rows.map((row) => Number(row.sort_order ?? 0));
  const needsBackfill = new Set(sortOrders).size === 1;
  if (!needsBackfill) return;

  transaction(() => {
    rows.forEach((row, index) => {
      run("UPDATE mcp_servers SET sort_order = ? WHERE id = ?", [index, row.id]);
    });
  });
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
    db = null;
  }
}

export function getDbPath() {
  return dbPath;
}
