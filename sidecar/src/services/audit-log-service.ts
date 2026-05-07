import { queryAll, queryOne } from "../db/index.js";
import { serializeAuditLog, keysToCamelCase } from "../db/serializers.js";

class AuditLogService {
  queryLogs(filters: {
    server_id?: string;
    tool_name?: string;
    from?: string;
    to?: string;
    limit?: string;
    offset?: string;
  }) {
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

    return queryAll(sql, params).map(serializeAuditLog);
  }

  getStats() {
    const totalCalls = (queryOne("SELECT COUNT(*) as count FROM audit_logs", [])?.count ??
      0) as number;
    const errorCalls = (queryOne(
      "SELECT COUNT(*) as count FROM audit_logs WHERE error IS NOT NULL",
      [],
    )?.count ?? 0) as number;
    const avgResult = queryOne("SELECT AVG(duration_ms) as avg FROM audit_logs", []);
    const avgDuration = avgResult?.avg as number | null;
    const topTools = queryAll(
      "SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration FROM audit_logs GROUP BY tool_name ORDER BY count DESC LIMIT 10",
      [],
    );
    const topServers = queryAll(
      "SELECT server_id, COUNT(*) as count FROM audit_logs GROUP BY server_id ORDER BY count DESC LIMIT 10",
      [],
    );

    return {
      totalCalls,
      errorCalls,
      errorRate: totalCalls > 0 ? errorCalls / totalCalls : 0,
      avgDurationMs: avgDuration,
      topTools: topTools.map(keysToCamelCase),
      topServers: topServers.map(keysToCamelCase),
    };
  }
}

export const auditLogService = new AuditLogService();
