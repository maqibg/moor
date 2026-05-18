import { Hono } from "hono";
import { servers } from "./api/servers.js";
import { profiles } from "./api/profiles.js";
import { logs } from "./api/logs.js";
import { settings } from "./api/settings.js";
import { events } from "./api/events.js";
import { importApi } from "./api/import.js";
import { gateway } from "./mcp/gateway.js";
import { createSecurityMiddleware } from "./services/security.js";

declare const APP_VERSION: string;

export interface AppOptions {
  apiToken: string;
  port: number;
  host: string;
}

export function createApp(options: AppOptions) {
  const app = new Hono();
  const baseUrl = `http://${options.host}:${options.port}`;

  app.use("*", createSecurityMiddleware({ apiToken: options.apiToken }));

  app.onError((err, c) => {
    console.error("Unhandled error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  });

  app.get("/api/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/runtime", (c) => {
    const version = typeof APP_VERSION === "undefined" ? "0.0.0-dev" : APP_VERSION;
    return c.json({
      port: options.port,
      baseUrl,
      apiTokenConfigured: Boolean(options.apiToken),
      version,
      pid: process.pid,
    });
  });

  app.route("/api/servers", servers);
  app.route("/api/profiles", profiles);
  app.route("/api/logs", logs);
  app.route("/api/settings", settings);
  app.route("/api/import", importApi);
  app.route("/api/events", events);
  app.route("/", gateway);

  return app;
}
