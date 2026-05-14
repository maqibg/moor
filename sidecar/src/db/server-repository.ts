import type { Database } from "./index.js";
import { getDatabase } from "./index.js";
import type { Server, ServerStatus } from "@moor/types";
import { parseJsonValue } from "./serializers.js";

const FIND_BY_IDS_BATCH_SIZE = 500;

function toServer(row: Record<string, unknown>): Server {
  return {
    id: String(row.id),
    name: String(row.name),
    connectionType: row.connection_type as "stdio" | "http",
    command: (row.command as string | null) ?? null,
    args: (parseJsonValue(row.args, []) ?? []) as string[],
    url: (row.url as string | null) ?? null,
    env: (parseJsonValue(row.env, {}) ?? {}) as Record<string, string>,
    headers: parseJsonValue(row.headers, null) as Record<string, string> | null,
    workingDir: (row.working_dir as string | null) ?? null,
    autoStart: Boolean(row.auto_start),
    sortOrder: Number(row.sort_order ?? 0),
    status: row.status as ServerStatus,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ServerRepository {
  constructor(private db: Database) {}

  findAll(): Server[] {
    return this.db
      .queryAll("SELECT * FROM mcp_servers ORDER BY sort_order ASC, created_at DESC", [])
      .map(toServer);
  }

  findAllNames(): Array<{ id: string; name: string }> {
    return this.db
      .queryAll("SELECT id, name FROM mcp_servers ORDER BY name ASC", [])
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
      }));
  }

  findIds(): string[] {
    return this.db.queryAll("SELECT id FROM mcp_servers", []).map((row) => String(row.id));
  }

  findById(id: string): Server | null {
    const row = this.db.queryOne("SELECT * FROM mcp_servers WHERE id = ?", [id]);
    return row ? toServer(row) : null;
  }

  findByIds(ids: string[]): Server[] {
    if (ids.length === 0) return [];
    const uniqueIds = Array.from(new Set(ids));
    const rows: Record<string, unknown>[] = [];
    for (let start = 0; start < uniqueIds.length; start += FIND_BY_IDS_BATCH_SIZE) {
      const batch = uniqueIds.slice(start, start + FIND_BY_IDS_BATCH_SIZE);
      rows.push(
        ...this.db.queryAll(
          `SELECT * FROM mcp_servers WHERE id IN (${batch.map(() => "?").join(",")})`,
          batch,
        ),
      );
    }
    const byId = new Map(rows.map((row) => [String(row.id), toServer(row)]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  loadAll(): Server[] {
    return this.db.queryAll("SELECT * FROM mcp_servers", []).map(toServer);
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

  update(id: string, fields: Record<string, unknown>): void {
    const columnMap: Record<string, string> = {
      name: "name",
      command: "command",
      args: "args",
      url: "url",
      env: "env",
      headers: "headers",
      workingDir: "working_dir",
      working_dir: "working_dir",
      autoStart: "auto_start",
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [field, col] of Object.entries(columnMap)) {
      if (field in fields) {
        setClauses.push(`${col} = ?`);
        const val = fields[field];
        if (col === "auto_start") {
          values.push(val ? 1 : 0);
        } else if (typeof val === "object" && val !== null) {
          values.push(JSON.stringify(val));
        } else {
          values.push(val);
        }
      }
    }

    if (setClauses.length === 0) return;
    setClauses.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    this.db.run(`UPDATE mcp_servers SET ${setClauses.join(", ")} WHERE id = ?`, values);
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
