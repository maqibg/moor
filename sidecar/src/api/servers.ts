import { Hono } from "hono";
import { serverManager } from "../services/server-manager.js";
import { queryAll, queryOne, run } from "../db/index.js";
import { serializeServer, serializeToolDiscovery } from "../db/serializers.js";

const servers = new Hono();

servers.get("/", (c) => {
  const rows = queryAll(
    `
    SELECT s.*, GROUP_CONCAT(td.tool_name) as tools
    FROM mcp_servers s
    LEFT JOIN tool_discoveries td ON s.id = td.server_id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `,
    [],
  );
  return c.json(rows.map(serializeServer));
});

servers.post("/", async (c) => {
  const body = await c.req.json<{
    name?: string;
    connectionType?: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    workingDir?: string;
  }>();
  if (!body.name || !body.connectionType) {
    return c.json({ error: "name and connectionType are required" }, 400);
  }
  if (body.connectionType !== "stdio" && body.connectionType !== "http") {
    return c.json({ error: "connectionType must be stdio or http" }, 400);
  }
  if (body.connectionType === "stdio" && !body.command) {
    return c.json({ error: "command is required for stdio servers" }, 400);
  }
  if (body.connectionType === "http" && !body.url) {
    return c.json({ error: "url is required for http servers" }, 400);
  }
  const server = serverManager.addServer({
    name: body.name,
    connectionType: body.connectionType,
    command: body.command,
    args: body.args,
    url: body.url,
    env: body.env,
    headers: body.headers,
    workingDir: body.workingDir,
  });
  const activeProfileId = serverManager.getActiveProfileId();
  if (activeProfileId) {
    run(
      "INSERT OR IGNORE INTO profile_servers (profile_id, server_id, enabled, disabled_tools) VALUES (?, ?, 1, '[]')",
      [activeProfileId, server.id],
    );
  }
  const row = queryOne("SELECT * FROM mcp_servers WHERE id = ?", [server.id]);
  return c.json(serializeServer({ ...row, ...server }), 201);
});

servers.get("/:id", (c) => {
  const server = serverManager.getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Server not found" }, 404);
  const row = queryOne("SELECT * FROM mcp_servers WHERE id = ?", [c.req.param("id")]);
  return c.json({ ...serializeServer(row ?? {}), runtime: server });
});

servers.put("/:id", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const server = serverManager.updateServer(c.req.param("id"), body);
  if (!server) return c.json({ error: "Server not found" }, 404);
  const row = queryOne("SELECT * FROM mcp_servers WHERE id = ?", [server.id]);
  return c.json({ ...serializeServer(row ?? {}), runtime: server });
});

servers.delete("/:id", async (c) => {
  const removed = await serverManager.removeServer(c.req.param("id"));
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

servers.post("/:id/stop", async (c) => {
  await serverManager.stopServer(c.req.param("id"));
  return c.json({ status: "stopped" });
});

servers.get("/:id/tools", (c) => {
  const profileId = c.req.query("profile_id") ?? serverManager.getActiveProfileId() ?? undefined;
  const catalog = profileId
    ? serverManager.getToolCatalog(profileId)
    : serverManager.getToolCatalog();
  const disabledRows = profileId
    ? queryAll(
        "SELECT disabled_tools FROM profile_servers WHERE profile_id = ? AND server_id = ?",
        [profileId, c.req.param("id")],
      )
    : queryAll("SELECT disabled_tools FROM profile_servers WHERE server_id = ?", [
        c.req.param("id"),
      ]);
  const disabledForServer = new Set(
    disabledRows.flatMap((row) => {
      try {
        return JSON.parse(row.disabled_tools as string) as string[];
      } catch {
        return [];
      }
    }),
  );
  const tools = serverManager.getDiscoveredTools(c.req.param("id")).map((row) => {
    const serialized = serializeToolDiscovery(row);
    const rawToolName = serialized.tool_name as string;
    const catalogEntry = catalog.find(
      (tool) => tool.serverId === c.req.param("id") && tool.toolName === rawToolName,
    );
    return {
      ...serialized,
      exposed_name: catalogEntry?.exposedName ?? rawToolName,
      disabled: disabledForServer.has(rawToolName),
    };
  });
  return c.json(tools);
});

export { servers };
