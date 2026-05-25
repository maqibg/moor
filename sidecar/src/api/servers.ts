import { Hono } from "hono";
import { getPublicServerStartErrorMessage, serverManager } from "../services/server-manager.js";
import { getServerRepository } from "../db/server-repository.js";
import { createServerSchema, serverOrderSchema, updateServerSchemaFor } from "./schemas.js";
import { apiError, validate } from "./validate.js";
import type { ServerUpdateInput } from "@moor/types";

const servers = new Hono();

servers.get("/", (c) => {
  return c.json(serverManager.listServers());
});

servers.post("/", async (c) => {
  const raw = await c.req.json();
  const body = validate(createServerSchema, raw, c);
  if (body instanceof Response) return body;
  const server = serverManager.addServer(body);
  return c.json(server, 201);
});

servers.put("/order", async (c) => {
  const raw = await c.req.json();
  const body = validate(serverOrderSchema, raw, c);
  if (body instanceof Response) return body;
  const repo = getServerRepository();
  const existingIds = repo.findIds();
  const existing = new Set(existingIds);
  if (
    new Set(body.serverIds).size !== body.serverIds.length ||
    body.serverIds.length !== existingIds.length ||
    body.serverIds.some((id) => !existing.has(id))
  ) {
    return c.json(
      apiError("ORDER_INVALID", "Server order must include every existing server exactly once."),
      400,
    );
  }
  repo.reorder(body.serverIds);
  return c.json(repo.findAll());
});

servers.get("/:id", (c) => {
  const result = serverManager.getServerDetail(c.req.param("id"));
  if (!result) {
    return c.json(apiError("NOT_FOUND", "Server not found"), 404);
  }
  return c.json(result);
});

servers.put("/:id", async (c) => {
  const raw = await c.req.json();
  const id = c.req.param("id");
  const server = getServerRepository().findById(id);
  if (!server) {
    return c.json(apiError("NOT_FOUND", "Server not found"), 404);
  }
  const body = validate<ServerUpdateInput>(updateServerSchemaFor(server.connectionType), raw, c);
  if (body instanceof Response) return body;
  const updated = serverManager.updateServer(id, body);
  return c.json(updated);
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
