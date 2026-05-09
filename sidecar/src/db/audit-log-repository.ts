import type { Database } from "./index.js";
import { getDatabase } from "./index.js";
import { parseJsonValue, keysToCamelCase } from "./serializers.js";
import type { AuditLogEntry, LogStats } from "@moor/types";

export type AuditLogRow = AuditLogEntry;
export type { LogStats };

function serializeAuditLog(row: Record<string, unknown>): AuditLogRow {
  const camel = keysToCamelCase({
    ...row,
    arguments: parseJsonValue(row.arguments, null),
    result: parseJsonValue(row.result, null),
  });
  return {
    id: String(camel.id),
    timestamp: String(camel.timestamp),
    profileId: (camel.profileId ?? null) as string | null,
    serverId: (camel.serverId ?? null) as string | null,
    toolName: String(camel.toolName),
    arguments: camel.arguments,
    result: camel.result,
    error: (camel.error ?? null) as string | null,
    durationMs: (camel.durationMs ?? null) as number | null,
    agentInfo: (camel.agentInfo ?? null) as string | null,
  };
}

export class AuditLogRepository {
  constructor(private db: Database) {}

  queryLogs(filters: {
    server_id?: string;
    tool_name?: string;
    from?: string;
    to?: string;
    limit?: string;
    offset?: string;
  }): AuditLogRow[] {
    let sql = "SELECT * FROM audit_logs WHERE 1=1";
    const params: unknown[] = [];

    if (filters.server_id) {
      sql += " AND server_id = ?";
      params.push(filters.server_id);
    }
    if (filters.tool_name) {
      sql += " AND tool_name = ?";
      params.push(filters.tool_name);
    }
    if (filters.from) {
      sql += " AND timestamp >= ?";
      params.push(filters.from);
    }
    if (filters.to) {
      sql += " AND timestamp <= ?";
      params.push(filters.to);
    }

    const safeLimit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(filters.offset) || 0, 0);
    sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
    params.push(safeLimit, safeOffset);

    return this.db.queryAll(sql, params).map(serializeAuditLog);
  }

  topTools(): Array<{ toolName: string; count: number; avgDuration: number }> {
    return this.db
      .queryAll(
        "SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration FROM audit_logs GROUP BY tool_name ORDER BY count DESC LIMIT 10",
        [],
      )
      .map(keysToCamelCase) as Array<{ toolName: string; count: number; avgDuration: number }>;
  }

  topServers(): Array<{ serverId: string; count: number }> {
    return this.db
      .queryAll(
        "SELECT server_id, COUNT(*) as count FROM audit_logs WHERE server_id IS NOT NULL GROUP BY server_id ORDER BY count DESC LIMIT 10",
        [],
      )
      .map(keysToCamelCase) as Array<{ serverId: string; count: number }>;
  }

  insert(entry: {
    id: string;
    timestamp: string;
    profileId: string | null;
    serverId: string | null;
    toolName: string;
    arguments: unknown;
    result: unknown;
    error: string | null;
    durationMs: number;
    agentInfo: string | null;
  }): void {
    this.db.run(
      `INSERT INTO audit_logs (id, timestamp, profile_id, server_id, tool_name, arguments, result, error, duration_ms, agent_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.timestamp,
        entry.profileId,
        entry.serverId,
        entry.toolName,
        entry.arguments !== null ? JSON.stringify(entry.arguments) : null,
        entry.result !== null ? JSON.stringify(entry.result) : null,
        entry.error,
        entry.durationMs,
        entry.agentInfo,
      ],
    );
  }

  deleteOlderThan(timestamp: string): void {
    this.db.run("DELETE FROM audit_logs WHERE timestamp < ?", [timestamp]);
  }

  getStats(): LogStats {
    const summary = this.db.queryOne(
      `SELECT
        COUNT(*) as total_calls,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as error_calls,
        AVG(duration_ms) as avg_duration_ms
       FROM audit_logs`,
      [],
    );
    const totalCalls = Number(summary?.total_calls ?? 0);
    const errorCalls = Number(summary?.error_calls ?? 0);
    return {
      totalCalls,
      errorCalls,
      errorRate: totalCalls > 0 ? errorCalls / totalCalls : 0,
      avgDurationMs: (summary?.avg_duration_ms as number | null) ?? null,
      topTools: this.topTools(),
      topServers: this.topServers(),
    };
  }
}

export function getAuditLogRepository(): AuditLogRepository {
  return new AuditLogRepository(getDatabase());
}
