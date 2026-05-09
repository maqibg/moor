import { Hono } from "hono";
import { getPublicServerStartErrorMessage, serverManager } from "../services/server-manager.js";
import { profileService } from "../services/profiles.js";
import { getServerRepository } from "../db/server-repository.js";
import { createServerSchema, serverOrderSchema } from "./schemas.js";
import { apiError, validate } from "./validate.js";

const servers = new Hono();

servers.get("/", (c) => {
  const rows = getServerRepository().findAll();
  return c.json(rows);
});

servers.post("/", async (c) => {
  const raw = await c.req.json();
  const body = validate(createServerSchema, raw, c);
  if (body instanceof Response) return body;
  const server = serverManager.addServer(body);
  profileService.assignToActiveProfile([server.id]);
  const row = getServerRepository().findById(server.id);
  if (!row) return c.json(apiError("INTERNAL_ERROR", "Created server could not be reloaded"), 500);
  return c.json(row, 201);
});

servers.put("/order", async (c) => {
  const raw = await c.req.json();
  const body = validate(serverOrderSchema, raw, c);
  if (body instanceof Response) return body;
  const rows = serverManager.reorderServers(body.serverIds);
  if (!rows) {
    return c.json(
      apiError("ORDER_INVALID", "Server order must include every existing server exactly once."),
      400,
    );
  }
  return c.json(rows);
});

servers.get("/:id", (c) => {
  const server = serverManager.getServer(c.req.param("id"));
  if (!server) {
    return c.json(apiError("NOT_FOUND", "Server not found"), 404);
  }
  const row = getServerRepository().findById(c.req.param("id"));
  if (!row) return c.json(apiError("INTERNAL_ERROR", "Server row could not be reloaded"), 500);
  return c.json({ ...row, runtime: server });
});

servers.put("/:id", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const server = serverManager.updateServer(c.req.param("id"), body);
  if (!server) {
    return c.json(apiError("NOT_FOUND", "Server not found"), 404);
  }
  const row = getServerRepository().findById(server.id);
  if (!row) return c.json(apiError("INTERNAL_ERROR", "Updated server could not be reloaded"), 500);
  return c.json(row);
});

servers.delete("/:id", async (c) => {
  const removed = await serverManager.removeServer(c.req.param("id"));
  if (!removed) {
    return c.json(apiError("NOT_FOUND", "Server not found"), 404);
  }
  return c.json({ success: true });
});

servers.post("/:id/start", async (c) => {
  try {
    await serverManager.startServer(c.req.param("id"));
    return c.json({ status: "started" });
  } catch (err) {
    return c.json(apiError("INTERNAL_ERROR", getPublicServerStartErrorMessage(err)), 500);
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
