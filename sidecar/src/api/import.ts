import { Hono } from "hono";
import { scanAllConfigs } from "../config/scanner.js";
import { generateSnippets } from "../config/snippets.js";
import { serverManager } from "../services/server-manager.js";
import { queryAll, queryOne, run, saveDb } from "../db/index.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ScannedServer } from "../config/scanner.js";

const importApi = new Hono();

export function selectImportCandidates(
  servers: ScannedServer[],
  existingNames: Set<string>,
): ScannedServer[] {
  return servers.filter((server) => !existingNames.has(server.name));
}

importApi.post("/scan", (c) => {
  const servers = scanAllConfigs();
  const existingServers = queryAll("SELECT name FROM mcp_servers", []);
  const existingNames = new Set(existingServers.map((s) => s.name as string));
  const newServers = selectImportCandidates(servers, existingNames);
  return c.json({ scanned: servers.length, newServers: newServers.length, servers: newServers });
});

importApi.post("/execute", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { servers?: ScannedServer[] };
  const existingServers = queryAll("SELECT name FROM mcp_servers", []);
  const existingNames = new Set(existingServers.map((s) => s.name as string));
  const servers = body.servers?.length
    ? body.servers
    : selectImportCandidates(scanAllConfigs(), existingNames);
  const imported: string[] = [];
  const skipped: string[] = [];

  for (const serverConfig of servers) {
    const existing = queryOne("SELECT id FROM mcp_servers WHERE name = ?", [serverConfig.name]);
    if (existing) {
      skipped.push(serverConfig.name);
      continue;
    }

    serverManager.addServer({
      name: serverConfig.name,
      connectionType: serverConfig.connectionType as "stdio" | "http",
      command: serverConfig.command,
      args: serverConfig.args,
      url: serverConfig.url,
      env: serverConfig.env,
    });
    imported.push(serverConfig.name);
  }

  const activeProfile = queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
  if (activeProfile) {
    for (const name of imported) {
      const server = queryOne("SELECT id FROM mcp_servers WHERE name = ?", [name]);
      if (server) {
        run(
          "INSERT OR IGNORE INTO profile_servers (profile_id, server_id, enabled, disabled_tools) VALUES (?, ?, 1, '[]')",
          [activeProfile.id, server.id],
        );
      }
    }
    saveDb();
  }

  return c.json({ imported, skipped });
});

importApi.get("/snippets", (c) => {
  const portFile = path.join(os.homedir(), ".moor", "port");
  let port = 9223;
  try {
    port = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
  } catch {
    // Keep the default port when no runtime port file exists.
  }
  const token = c.req.header("x-moor-token") ?? "";
  return c.json(generateSnippets(port, token));
});

export { importApi };
