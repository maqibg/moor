import { Hono } from "hono";
import { getAuditLogRepository } from "../db/audit-log-repository.js";

const logs = new Hono();

logs.get("/", (c) => {
  const { server_id, tool_name, from, to, limit, offset } = c.req.query();
  return c.json(
    getAuditLogRepository().queryLogs({ server_id, tool_name, from, to, limit, offset }),
  );
});

logs.get("/stats", (c) => {
  return c.json(getAuditLogRepository().getStats());
});

export { logs };
