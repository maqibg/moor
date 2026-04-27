import { Hono } from "hono";
import { scanAllConfigs } from "../config/scanner.js";
import { generateSnippets } from "../config/snippets.js";
import { serverManager } from "../services/server-manager.js";
import { queryAll, run, saveDb } from "../db/index.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const importApi = new Hono();

importApi.post("/scan", (c) => {
  const servers = scanAllConfigs();
  const existingServers = queryAll("SELECT name FROM mcp_servers", []);
  const existingNames = new Set(existingServers.map((s) => s.name as string));
  const newServers = servers.filter((s) => !existingNames.has(s.name));
  return c.json({ scanned: servers.length, newServers: newServers.length, servers: newServers });
});

importApi.post("/execute", (c) => {
  return c.req.json().then((body: { servers?: Array<{ name: string; connectionType: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }> }) => {
    const servers = body.servers || [];
    const imported: string[] = [];
    const skipped: string[] = [];

    for (const serverConfig of servers) {
      const existing = queryOne("SELECT id FROM mcp_servers WHERE name = ?", [serverConfig.name]);
      if (existing) { skipped.push(serverConfig.name); continue; }

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
          run("INSERT OR IGNORE INTO profile_servers (profile_id, server_id, enabled, disabled_tools) VALUES (?, ?, 1, '[]')", [activeProfile.id, server.id]);
        }
      }
      saveDb();
    }

    return c.json({ imported, skipped });
  });
});

importApi.get("/snippets", (c) => {
  const portFile = path.join(os.homedir(), ".moor", "port");
  let port = 9223;
  try { port = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10); } catch {}
  return c.json(generateSnippets(port));
});

export { importApi };
