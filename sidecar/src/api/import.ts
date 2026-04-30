import { Hono } from "hono";
import { scanAllConfigs } from "../config/scanner.js";
import {
  parseJsonMcpConfig,
  type ImportDiagnostic,
  type ParsedImport,
} from "../config/import-parser.js";
import { generateSnippets } from "../config/snippets.js";
import { serverManager } from "../services/server-manager.js";
import { queryAll, queryOne, run, saveDb } from "../db/index.js";
import type { ScannedServer, UnsupportedServer } from "../config/scanner.js";

const importApi = new Hono();

const MAX_PARSE_BODY_BYTES = 512 * 1024; // 512 KB

interface ImportPreview {
  scanned: number;
  newServers: number;
  servers: ScannedServer[];
  duplicates: ScannedServer[];
  unsupported: UnsupportedServer[];
  errors: string[];
  diagnostics: ImportDiagnostic[];
}

export function selectImportCandidates(
  servers: ScannedServer[],
  existingNames: Set<string>,
): ScannedServer[] {
  const seenNames = new Set(existingNames);
  return servers.filter((server) => {
    if (seenNames.has(server.name)) return false;
    seenNames.add(server.name);
    return true;
  });
}

function getExistingNames(): Set<string> {
  const existingServers = queryAll("SELECT name FROM mcp_servers", []);
  return new Set(existingServers.map((server) => server.name as string));
}

function buildImportPreview(parsed: ParsedImport, existingNames: Set<string>): ImportPreview {
  const seenNames = new Set(existingNames);
  const servers: ScannedServer[] = [];
  const duplicates: ScannedServer[] = [];

  for (const server of parsed.servers) {
    if (seenNames.has(server.name)) {
      duplicates.push(server);
      continue;
    }
    seenNames.add(server.name);
    servers.push(server);
  }

  return {
    scanned: parsed.servers.length + parsed.unsupported.length,
    newServers: servers.length,
    servers,
    duplicates,
    unsupported: parsed.unsupported,
    errors: parsed.errors,
    diagnostics: parsed.diagnostics,
  };
}

importApi.post("/scan", (c) => {
  const parsed = scanAllConfigs();
  const preview = buildImportPreview(parsed, getExistingNames());
  return c.json(preview);
});

importApi.post("/parse", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { content?: string };
  if (!body.content?.trim()) {
    return c.json({ error: "content is required" }, 400);
  }
  if (body.content.length > MAX_PARSE_BODY_BYTES) {
    return c.json({ error: "content exceeds maximum allowed size" }, 413);
  }

  const parsed = parseJsonMcpConfig(body.content, "json-import");
  return c.json(buildImportPreview(parsed, getExistingNames()));
});

importApi.post("/execute", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { servers?: ScannedServer[] };
  const existingNames = getExistingNames();
  const servers = body.servers?.length
    ? selectImportCandidates(body.servers, existingNames)
    : selectImportCandidates(scanAllConfigs().servers, existingNames);
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
      connectionType: serverConfig.connectionType,
      command: serverConfig.command,
      args: serverConfig.args,
      url: serverConfig.url,
      env: serverConfig.env,
      headers: serverConfig.headers,
      workingDir: serverConfig.workingDir,
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
  const url = new URL(c.req.url);
  return c.json(generateSnippets(`${url.protocol}//${url.host}/mcp`));
});

export { importApi };
