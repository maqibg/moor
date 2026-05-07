import { queryAll, queryOne } from "../db/index.js";
import type { ScannedServer, ParsedImport, ImportPreview } from "@moor/types";

export function getExistingNames(): Set<string> {
  const existingServers = queryAll("SELECT name FROM mcp_servers", []);
  return new Set(existingServers.map((server) => server.name as string));
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

export function buildImportPreview(
  parsed: ParsedImport,
  existingNames: Set<string>,
): ImportPreview {
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

export function findServerIdByName(name: string): string | undefined {
  return queryOne("SELECT id FROM mcp_servers WHERE name = ?", [name])?.id as string | undefined;
}
