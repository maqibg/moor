import { Hono } from "hono";
import { profileService } from "../services/profiles.js";
import { createProfileSchema, updateProfileSchema, updateProfileServerSchema } from "./schemas.js";
import { apiError, validate } from "./validate.js";

const profiles = new Hono();

profiles.get("/", (c) => {
  return c.json(profileService.list());
});

profiles.post("/", async (c) => {
  const raw = await c.req.json();
  const body = validate(createProfileSchema, raw, c);
  if (body instanceof Response) return body;
  return c.json(profileService.create(body.name), 201);
});

profiles.get("/:id", (c) => {
  const result = profileService.getById(c.req.param("id"));
  if (!result) {
    return c.json(apiError("NOT_FOUND", "Profile not found"), 404);
  }
  return c.json(result);
});

profiles.put("/:id", async (c) => {
  const raw = await c.req.json();
  const body = validate(updateProfileSchema, raw, c);
  if (body instanceof Response) return body;
  const result = profileService.update(c.req.param("id"), body);
  if (!result) {
    return c.json(apiError("NOT_FOUND", "Profile not found"), 404);
  }
  return c.json(result);
});

profiles.delete("/:id", (c) => {
  const result = profileService.remove(c.req.param("id"));
  if ("error" in result) {
    if (result.error === "not_found") {
      return c.json(apiError("NOT_FOUND", "Profile not found"), 404);
    }
    if (result.error === "active") {
      return c.json(apiError("ACTIVE_PROFILE", "Cannot delete active profile"), 400);
    }
  }
  return c.json({ success: true });
});

profiles.put("/:id/activate", (c) => {
  const result = profileService.activate(c.req.param("id"));
  if (!result) {
    return c.json(apiError("NOT_FOUND", "Profile not found"), 404);
  }
  return c.json(result);
});

profiles.put("/:id/servers/:sid", async (c) => {
  const raw = await c.req.json();
  const body = validate(updateProfileServerSchema, raw, c);
  if (body instanceof Response) return body;
  const result = profileService.updateProfileServer(c.req.param("id"), c.req.param("sid"), body);
  return c.json(result);
});

export { profiles };
