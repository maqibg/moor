import { Hono } from "hono";
import { queryAll, queryOne } from "../db/index.js";
import { serializeAuditLog } from "../db/serializers.js";

const logs = new Hono();

logs.get("/", (c) => {
  const { server_id, tool_name, from, to, limit = "50", offset = "0" } = c.req.query();
  let sql = "SELECT * FROM audit_logs WHERE 1=1";
  const params: unknown[] = [];

  if (server_id) {
    sql += " AND server_id = ?";
    params.push(server_id);
  }
  if (tool_name) {
    sql += " AND tool_name = ?";
    params.push(tool_name);
  }
  if (from) {
    sql += " AND timestamp >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND timestamp <= ?";
    params.push(to);
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
  params.push(safeLimit, safeOffset);

  const rows = queryAll(sql, params);
  return c.json(rows.map(serializeAuditLog));
});

logs.get("/stats", (c) => {
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

  return c.json({
    totalCalls,
    errorCalls,
    errorRate: totalCalls > 0 ? errorCalls / totalCalls : 0,
    avgDurationMs: avgDuration,
    topTools,
    topServers,
  });
});

export { logs };
