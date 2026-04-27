import { serve } from "@hono/node-server";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "./server.js";
import { gateway } from "./mcp/gateway.js";
import { initDb, runMigrations, seedDefaultProfile, closeDb, saveDb } from "./db/index.js";
import { serverManager } from "./services/server-manager.js";
import { initAuditLogger, getAuditLogger } from "./services/audit-logger.js";
import { importApi } from "./api/import.js";

const DEFAULT_PORT = 9223;
const PORT_FILE = path.join(os.homedir(), ".moor", "port");

function findAvailablePort(start: number, max: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number) {
      if (port > max) {
        reject(new Error(`No available port in range ${start}-${max}`));
        return;
      }
      const server = net.createServer();
      server.listen(port, "127.0.0.1", () => { server.close(() => resolve(port)); });
      server.on("error", () => tryPort(port + 1));
    }
    tryPort(start);
  });
}

function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    serverManager.stopAll();
    await getAuditLogger().drain();
    saveDb();
    closeDb();
    try { fs.unlinkSync(PORT_FILE); } catch {}
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function main() {
  await initDb();
  runMigrations();
  seedDefaultProfile();

  const auditLogger = initAuditLogger();
  auditLogger.start();
  serverManager.loadFromDb();

  app.route("/", gateway);
  app.route("/api/import", importApi);

  const port = await findAvailablePort(DEFAULT_PORT, DEFAULT_PORT + 10);

  fs.mkdirSync(path.join(os.homedir(), ".moor"), { recursive: true });
  fs.writeFileSync(PORT_FILE, String(port));

  setupGracefulShutdown();

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Moor sidecar running on http://localhost:${info.port}`);
    console.log(`MCP endpoint: http://localhost:${info.port}/mcp`);
    console.log(`Health check: http://localhost:${info.port}/api/health`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
