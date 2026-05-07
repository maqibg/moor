import { Hono } from "hono";
import { auditLogService } from "../services/audit-log-service.js";

const logs = new Hono();

logs.get("/", (c) => {
  const { server_id, tool_name, from, to, limit, offset } = c.req.query();
  return c.json(auditLogService.queryLogs({ server_id, tool_name, from, to, limit, offset }));
});

logs.get("/stats", (c) => {
  return c.json(auditLogService.getStats());
});

export { logs };
