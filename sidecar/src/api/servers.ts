import { Hono } from "hono";
import { serverManager } from "../services/server-manager.js";
import { profileService } from "../services/profiles.js";
import { queryOne } from "../db/index.js";
import * as serverRepo from "../db/server-repository.js";
import { serializeServer } from "../db/serializers.js";
import { createServerSchema, serverOrderSchema } from "./schemas.js";
import { validate } from "./validate.js";

const servers = new Hono();

servers.get("/", (c) => {
  const rows = serverRepo.findAll();
  return c.json(rows.map(serializeServer));
});

servers.post("/", async (c) => {
  const raw = await c.req.json();
  const body = validate(createServerSchema, raw, c);
  if (body instanceof Response) return body;
  const server = serverManager.addServer(body);
  profileService.assignToActiveProfile([server.id]);
  const row = queryOne("SELECT * FROM mcp_servers WHERE id = ?", [server.id]);
  return c.json(serializeServer({ ...row, ...server }), 201);
});

servers.put("/order", async (c) => {
  const raw = await c.req.json();
  const body = validate(serverOrderSchema, raw, c);
  if (body instanceof Response) return body;
  const rows = serverManager.reorderServers(body.serverIds);
  if (!rows) {
    return c.json({ error: "Server order must include every existing server exactly once." }, 400);
  }
  return c.json(rows.map(serializeServer));
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
  const serverId = c.req.param("id");
  const profileId = c.req.query("profile_id") ?? serverManager.getActiveProfileId() ?? undefined;
  return c.json(serverManager.getToolDetails(serverId, profileId));
});

export { servers };
