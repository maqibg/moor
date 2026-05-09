import type { Database } from "./index.js";
import { getDatabase } from "./index.js";
import type { Server } from "@moor/types";
import { parseJsonValue, keysToCamelCase } from "./serializers.js";

function serializeServer(row: Record<string, unknown>): Server {
  return keysToCamelCase({
    ...row,
    args: parseJsonValue(row.args, []),
    env: parseJsonValue(row.env, {}),
    headers: parseJsonValue(row.headers, null),
    auto_start: Boolean(row.auto_start),
  }) as unknown as Server;
}

export class ServerRepository {
  constructor(private db: Database) {}

  findAll(): Server[] {
    return this.db
      .queryAll(
        `SELECT s.*, GROUP_CONCAT(td.tool_name) as tools
         FROM mcp_servers s
         LEFT JOIN tool_discoveries td ON s.id = td.server_id
         GROUP BY s.id
         ORDER BY s.sort_order ASC, s.created_at DESC`,
        [],
      )
      .map(serializeServer);
  }

  findIds(): string[] {
    return this.db.queryAll("SELECT id FROM mcp_servers", []).map((row) => String(row.id));
  }

  findById(id: string): Server | null {
    const row = this.db.queryOne("SELECT * FROM mcp_servers WHERE id = ?", [id]);
    return row ? serializeServer(row) : null;
  }

  findByIds(ids: string[]): Server[] {
    if (ids.length === 0) return [];
    const uniqueIds = Array.from(new Set(ids));
    const rows = this.db.queryAll(
      `SELECT * FROM mcp_servers WHERE id IN (${uniqueIds.map(() => "?").join(",")})`,
      uniqueIds,
    );
    const byId = new Map(rows.map((row) => [String(row.id), serializeServer(row)]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  loadAll(): Server[] {
    return this.db.queryAll("SELECT * FROM mcp_servers", []).map(serializeServer);
  }

  insert(data: {
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
  }): void {
    this.db.run(
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

  nextTopSortOrder(): number {
    const row = this.db.queryOne("SELECT MIN(sort_order) AS min_sort_order FROM mcp_servers", []);
    if (row?.min_sort_order == null) return 0;
    return Number(row.min_sort_order) - 1;
  }

  update(id: string, setClauses: string[], values: unknown[]): void {
    this.db.run(`UPDATE mcp_servers SET ${setClauses.join(", ")} WHERE id = ?`, [...values, id]);
  }

  remove(id: string): void {
    this.db.transaction(() => {
      this.db.run("UPDATE audit_logs SET server_id = NULL WHERE server_id = ?", [id]);
      this.db.run("DELETE FROM mcp_servers WHERE id = ?", [id]);
    });
  }

  reorder(ids: string[]): void {
    this.db.transaction(() => {
      ids.forEach((id, index) => {
        this.db.run("UPDATE mcp_servers SET sort_order = ?, updated_at = ? WHERE id = ?", [
          index,
          new Date().toISOString(),
          id,
        ]);
      });
    });
  }

  updateStatus(id: string, status: string, errorMessage: string | null): void {
    this.db.run(
      "UPDATE mcp_servers SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
      [status, errorMessage, new Date().toISOString(), id],
    );
  }

  resetRunningStatuses(): void {
    this.db.run(
      "UPDATE mcp_servers SET status = 'stopped', error_message = NULL WHERE status IN ('running', 'starting')",
    );
  }
}

export function getServerRepository(): ServerRepository {
  return new ServerRepository(getDatabase());
}
