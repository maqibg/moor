import { Hono } from "hono";
import { serverManager } from "../services/server-manager.js";
import { queryAll, queryOne } from "../db/index.js";

const servers = new Hono();

servers.get("/", (c) => {
  const rows = queryAll(`
    SELECT s.*, GROUP_CONCAT(td.tool_name) as tools
    FROM mcp_servers s
    LEFT JOIN tool_discoveries td ON s.id = td.server_id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `, []);
  return c.json(rows);
});

servers.post("/", (c) => {
  return c.req.json().then((body: { name?: string; connectionType?: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }) => {
    if (!body.name || !body.connectionType) {
      return c.json({ error: "name and connectionType are required" }, 400);
    }
    const server = serverManager.addServer({
      name: body.name,
      connectionType: body.connectionType as "stdio" | "http",
      command: body.command,
      args: body.args,
      url: body.url,
      env: body.env,
    });
    return c.json(server, 201);
  });
});

servers.get("/:id", (c) => {
  const server = serverManager.getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Server not found" }, 404);
  const row = queryOne("SELECT * FROM mcp_servers WHERE id = ?", [c.req.param("id")]);
  return c.json({ ...row, runtime: server });
});

servers.put("/:id", (c) => {
  return c.req.json().then((body: Record<string, unknown>) => {
    const server = serverManager.updateServer(c.req.param("id"), body);
    if (!server) return c.json({ error: "Server not found" }, 404);
    return c.json(server);
  });
});

servers.delete("/:id", (c) => {
  const removed = serverManager.removeServer(c.req.param("id"));
  if (!removed) return c.json({ error: "Server not found" }, 404);
  return c.json({ success: true });
});

servers.post("/:id/start", async (c) => {
  try {
    await serverManager.startServer(c.req.param("id"));
    return c.json({ status: "started" });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

servers.post("/:id/stop", (c) => {
  serverManager.stopServer(c.req.param("id"));
  return c.json({ status: "stopped" });
});

servers.get("/:id/tools", (c) => {
  const tools = serverManager.getDiscoveredTools(c.req.param("id"));
  return c.json(tools);
});

export { servers };
