import { run, queryAll, queryOne } from "./index.js";

export function findAll(): Record<string, unknown>[] {
  return queryAll(
    `SELECT s.*, GROUP_CONCAT(td.tool_name) as tools
     FROM mcp_servers s
     LEFT JOIN tool_discoveries td ON s.id = td.server_id
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    [],
  );
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
  createdAt: string;
  updatedAt: string;
}

export function insert(data: InsertServerData): void {
  run(
    `INSERT INTO mcp_servers (id, name, connection_type, command, args, url, env, headers, working_dir, auto_start, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?)`,
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
      data.createdAt,
      data.updatedAt,
    ],
  );
}

export function update(id: string, setClauses: string[], values: unknown[]): void {
  run(`UPDATE mcp_servers SET ${setClauses.join(", ")} WHERE id = ?`, [...values, id]);
}

export function remove(id: string): void {
  run("DELETE FROM mcp_servers WHERE id = ?", [id]);
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
