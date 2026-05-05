import { serve } from "@hono/node-server";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

declare const APP_VERSION: string;
if (typeof APP_VERSION === "undefined") {
  // tsx dev mode fallback — esbuild define replaces this at build time
  (globalThis as Record<string, unknown>).APP_VERSION = "0.0.0-dev";
}

import { createApp } from "./server.js";
import { initDb, runMigrations, closeDb } from "./db/index.js";
import { profileService } from "./services/profiles.js";
import { serverManager } from "./services/server-manager.js";
import { initAuditLogger, getAuditLogger } from "./services/audit-logger.js";
import { settingsService } from "./services/settings.js";

const DEFAULT_PORT = 9223;

interface CliOptions {
  host: string;
  port: number;
  apiToken: string;
  dataDir: string;
  legacyDataDir?: string;
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseCliOptions(): CliOptions {
  const dataDir =
    readArg("--data-dir") ?? process.env.MOOR_DATA_DIR ?? path.join(os.homedir(), ".moor");
  return {
    host: readArg("--host") ?? process.env.MOOR_HOST ?? "127.0.0.1",
    port: Number(readArg("--port") ?? process.env.MOOR_PORT ?? DEFAULT_PORT),
    apiToken: readArg("--api-token") ?? process.env.MOOR_API_TOKEN ?? crypto.randomUUID(),
    dataDir,
    legacyDataDir: readArg("--legacy-data-dir") ?? process.env.MOOR_LEGACY_DATA_DIR,
  };
}

function findAvailablePort(host: string, start: number, max: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number) {
      if (port > max) {
        reject(new Error(`No available port in range ${start}-${max}`));
        return;
      }
      const server = net.createServer();
      server.listen(port, host, () => {
        server.close(() => resolve(port));
      });
      server.on("error", () => tryPort(port + 1));
    }
    tryPort(start);
  });
}

function setupGracefulShutdown(portFile: string) {
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    await serverManager.stopAll();
    await getAuditLogger().drain();
    closeDb();
    try {
      fs.unlinkSync(portFile);
    } catch {
      console.warn(`Port file already removed: ${portFile}`);
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function main() {
  const options = parseCliOptions();
  const port = await findAvailablePort(options.host, options.port, options.port + 10);
  const portFile = path.join(options.dataDir, "port");

  await initDb({ dataDir: options.dataDir, legacyDataDir: options.legacyDataDir });
  runMigrations();
  profileService.seedDefault();

  settingsService.init(options.dataDir);
  settingsService.startLogCleanupInterval();

  const auditLogger = initAuditLogger();
  auditLogger.start();
  serverManager.loadFromDb();

  fs.mkdirSync(options.dataDir, { recursive: true });
  fs.writeFileSync(portFile, String(port));

  setupGracefulShutdown(portFile);

  const app = createApp({ apiToken: options.apiToken, host: options.host, port });
  serve({ fetch: app.fetch, hostname: options.host, port }, (info) => {
    const baseUrl = `http://${options.host}:${info.port}`;
    console.log(`MOOR_READY ${JSON.stringify({ port: info.port, baseUrl })}`);
    console.log(`MCP endpoint: ${baseUrl}/mcp`);
    console.log(`Health check: ${baseUrl}/api/health`);

    const settings = settingsService.getSettings();
    if (settings.general.autoStartServersOnLaunch) {
      void serverManager.startAutoStartServers();
    }
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
