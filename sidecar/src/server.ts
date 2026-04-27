import { Hono } from "hono";
import { cors } from "hono/cors";
import { servers } from "./api/servers.js";
import { profiles } from "./api/profiles.js";
import { logs } from "./api/logs.js";
import { setupSSE } from "./api/events.js";

const app = new Hono();

app.use("*", cors());

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.route("/api/servers", servers);
app.route("/api/profiles", profiles);
app.route("/api/logs", logs);

app.get("/api/events", (c) => {
  return setupSSE(c);
});

export { app };
