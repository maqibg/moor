import { Hono } from "hono";
import { settingsService } from "../services/settings.js";
import { settingsUpdateSchema } from "./schemas.js";
import { apiError, validate } from "./validate.js";

const settings = new Hono();

settings.get("/", (c) => {
  return c.json(settingsService.getSettings());
});

settings.patch("/", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(apiError("VALIDATION_ERROR", "Invalid JSON"), 400);
  }
  const body = validate(settingsUpdateSchema, raw, c);
  if (body instanceof Response) return body;
  const updated = settingsService.updateSettings(body);
  return c.json(updated);
});

settings.post("/reset", (c) => {
  const defaults = settingsService.resetSettings();
  return c.json(defaults);
});

export { settings };
