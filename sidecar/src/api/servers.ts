import { Hono } from "hono";
import { getPublicServerStartErrorMessage, serverManager } from "../services/server-manager.js";
import { serverStore } from "../services/server-store.js";
import { profileService } from "../services/profiles.js";
import { createServerSchema, serverOrderSchema } from "./schemas.js";
import { apiError, validate } from "./validate.js";

const servers = new Hono();

servers.get("/", (c) => {
  return c.json(serverStore.findAll());
});

servers.post("/", async (c) => {
  const raw = await c.req.json();
  const body = validate(createServerSchema, raw, c);
  if (body instanceof Response) return body;
  const server = serverStore.add(body);
  serverManager.registerServer(server.id);
  profileService.assignToActiveProfile([server.id]);
  return c.json(server, 201);
});

servers.put("/order", async (c) => {
  const raw = await c.req.json();
  const body = validate(serverOrderSchema, raw, c);
  if (body instanceof Response) return body;
  const rows = serverStore.reorder(body.serverIds);
  if (!rows) {
    return c.json(
      apiError("ORDER_INVALID", "Server order must include every existing server exactly once."),
      400,
    );
  }
  return c.json(rows);
});

servers.get("/:id", (c) => {
  const row = serverStore.findById(c.req.param("id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Server not found"), 404);
  }
  const runtime = serverManager.getServer(c.req.param("id"));
  return c.json({ ...row, runtime });
});

servers.put("/:id", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const id = c.req.param("id");
  const server = serverStore.update(id, body);
  if (!server) {
    return c.json(apiError("NOT_FOUND", "Server not found"), 404);
  }
  const runtime = serverManager.getServer(id);
  if (runtime) {
    if (body.name) runtime.name = server.name;
    if ("autoStart" in body) runtime.autoStart = server.autoStart;
  }
  return c.json(server);
});

servers.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const runtime = serverManager.getServer(id);
  if (runtime?.status === "running") {
    await serverManager.stopServer(id);
  }
  const removed = serverStore.remove(id);
  if (!removed) {
    return c.json(apiError("NOT_FOUND", "Server not found"), 404);
  }
  serverManager.unregisterServer(id);
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
