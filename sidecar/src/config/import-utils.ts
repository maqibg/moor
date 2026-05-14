import { getServerRepository } from "../db/server-repository.js";
import type { ScannedServer, ParsedImport, ImportPreview } from "@moor/types";

export function getExistingNames(): Set<string> {
  const rows = getServerRepository().findAllNames();
  return new Set(rows.map((server) => server.name));
}

export function selectImportCandidates(
  servers: ScannedServer[],
  existingNames: Set<string>,
): ScannedServer[] {
  return partitionImportCandidates(servers, existingNames).candidates;
}

export function partitionImportCandidates(
  servers: ScannedServer[],
  existingNames: Set<string>,
): { candidates: ScannedServer[]; skipped: string[] } {
  const seenNames = new Set(existingNames);
  const candidates: ScannedServer[] = [];
  const skipped: string[] = [];

  for (const server of servers) {
    if (seenNames.has(server.name)) {
      skipped.push(server.name);
      continue;
    }
    seenNames.add(server.name);
    candidates.push(server);
  }

  return { candidates, skipped };
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
