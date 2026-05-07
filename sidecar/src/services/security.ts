import type { MiddlewareHandler } from "hono";

const ALLOWED_DEV_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

export interface SecurityOptions {
  apiToken: string;
  allowDevOrigins?: string[];
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0]?.toLowerCase();
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function isAllowedOrigin(origin: string | undefined, extraOrigins: string[] = []): boolean {
  if (!origin) return true;
  if (ALLOWED_DEV_ORIGINS.has(origin)) return true;
  return extraOrigins.includes(origin);
}

export function shouldRequireApiToken(path: string): boolean {
  return path.startsWith("/api/");
}

export function createSecurityMiddleware(options: SecurityOptions): MiddlewareHandler {
  const extraOrigins = options.allowDevOrigins ?? [];

  return async (c, next) => {
    const origin = c.req.header("origin");
    const host = c.req.header("host");

    if (!isLoopbackHost(host)) {
      return c.json({ error: "Invalid Host header" }, 403);
    }
    if (!isAllowedOrigin(origin, extraOrigins)) {
      return c.json({ error: "Invalid Origin header" }, 403);
    }

    if (c.req.method === "OPTIONS") {
      if (origin) c.header("Access-Control-Allow-Origin", origin);
      c.header(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Moor-Token, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Method, Mcp-Name",
      );
      c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      return c.body(null, 204);
    }

    if (origin) c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");

    if (shouldRequireApiToken(c.req.path)) {
      const token = c.req.header("x-moor-token");
      if (!token || token !== options.apiToken) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }

    await next();
  };
}
