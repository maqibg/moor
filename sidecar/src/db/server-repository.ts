import { run, queryAll, queryOne, transaction } from "./index.js";

export function findAll(): Record<string, unknown>[] {
  return queryAll(
    `SELECT s.*, GROUP_CONCAT(td.tool_name) as tools
     FROM mcp_servers s
     LEFT JOIN tool_discoveries td ON s.id = td.server_id
     GROUP BY s.id
     ORDER BY s.sort_order ASC, s.created_at DESC`,
    [],
  );
}

export function findIds(): string[] {
  return queryAll("SELECT id FROM mcp_servers", []).map((row) => String(row.id));
}

export function findById(id: string): Record<string, unknown> | null {
  return queryOne("SELECT * FROM mcp_servers WHERE id = ?", [id]);
}

export function findAutoStart(): Record<string, unknown>[] {
  return queryAll("SELECT * FROM mcp_servers WHERE auto_start = 1", []);
}

export function findActiveProfileServers(profileId: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT ps.*, ms.name, ms.connection_type, ms.status FROM profile_servers ps JOIN mcp_servers ms ON ps.server_id = ms.id WHERE ps.profile_id = ? AND ps.enabled = 1",
    [profileId],
  );
}

export interface InsertServerData {
  id: string;
  name: string;
  connectionType: string;
  command: string | null;
  args: string | null;
  url: string | null;
  env: string | null;
  headers: string | null;
  workingDir: string | null;
  autoStart: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function insert(data: InsertServerData): void {
  run(
    `INSERT INTO mcp_servers (id, name, connection_type, command, args, url, env, headers, working_dir, auto_start, sort_order, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?)`,
    [
      data.id,
      data.name,
      data.connectionType,
      data.command,
      data.args,
      data.url,
      data.env,
      data.headers,
      data.workingDir,
      data.autoStart,
      data.sortOrder,
      data.createdAt,
      data.updatedAt,
    ],
  );
}

export function nextTopSortOrder(): number {
  const row = queryOne("SELECT MIN(sort_order) AS min_sort_order FROM mcp_servers", []);
  if (row?.min_sort_order == null) return 0;
  return Number(row.min_sort_order) - 1;
}

export function update(id: string, setClauses: string[], values: unknown[]): void {
  run(`UPDATE mcp_servers SET ${setClauses.join(", ")} WHERE id = ?`, [...values, id]);
}

export function remove(id: string): void {
  transaction(() => {
    run("UPDATE audit_logs SET server_id = NULL WHERE server_id = ?", [id]);
    run("DELETE FROM mcp_servers WHERE id = ?", [id]);
  });
}

export function reorder(ids: string[]): void {
  transaction(() => {
    ids.forEach((id, index) => {
      run("UPDATE mcp_servers SET sort_order = ?, updated_at = ? WHERE id = ?", [
        index,
        new Date().toISOString(),
        id,
      ]);
    });
  });
}

export function updateStatus(id: string, status: string, errorMessage: string | null): void {
  run("UPDATE mcp_servers SET status = ?, error_message = ?, updated_at = ? WHERE id = ?", [
    status,
    errorMessage,
    new Date().toISOString(),
    id,
  ]);
}

export function resetRunningStatuses(): void {
  run(
    "UPDATE mcp_servers SET status = 'stopped', error_message = NULL WHERE status IN ('running', 'starting')",
  );
}

export function loadAll(): Record<string, unknown>[] {
  return queryAll("SELECT * FROM mcp_servers", []);
}
