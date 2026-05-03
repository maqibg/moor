import fs from "node:fs";
import { parseCodexTomlConfig, parseJsonMcpConfig, type ParsedImport } from "./import-parser.js";
import { ALL_CLIENTS, resolveConfigPaths } from "./clients.js";

export type { ScannedServer, UnsupportedServer } from "./import-parser.js";

const EMPTY: ParsedImport = { servers: [], unsupported: [], errors: [], diagnostics: [] };

function readFileIfExists(configPath: string): string | null {
  if (!fs.existsSync(configPath)) return null;
  try {
    return fs.readFileSync(configPath, "utf-8");
  } catch {
    return null;
  }
}

function parseConfigFile(
  configPath: string,
  source: string,
  format: "json" | "toml",
): ParsedImport {
  const content = readFileIfExists(configPath);
  if (!content) return EMPTY;
  const parser = format === "toml" ? parseCodexTomlConfig : parseJsonMcpConfig;
  return ignoreMissingMcpSections(parser(content, source), source);
}

function ignoreMissingMcpSections(result: ParsedImport, source: string): ParsedImport {
  const missingSectionErrors = new Set([
    `${source}: no mcpServers or mcp key found`,
    `${source}: no mcp_servers key found`,
  ]);
  const onlyMissingSections =
    result.servers.length === 0 &&
    result.unsupported.length === 0 &&
    result.errors.length > 0 &&
    result.errors.every((error) => missingSectionErrors.has(error));

  return onlyMissingSections ? EMPTY : result;
}

function mergeParsed(...results: ParsedImport[]): ParsedImport {
  return {
    servers: results.flatMap((r) => r.servers),
    unsupported: results.flatMap((r) => r.unsupported),
    errors: results.flatMap((r) => r.errors),
    diagnostics: results.flatMap((r) => r.diagnostics),
  };
}

function scanClient(client: (typeof ALL_CLIENTS)[number]): ParsedImport {
  const paths = resolveConfigPaths(client);
  const results = paths.map((p) => parseConfigFile(p, client.id, client.format));
  const merged = mergeParsed(...results);

  if (paths.length > 1) {
    const seen = new Set<string>();
    merged.servers = merged.servers.filter((s) => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });
  }

  return merged;
}

export function scanAllConfigs(): ParsedImport {
  return mergeParsed(...ALL_CLIENTS.map(scanClient));
}

export function scanClientConfig(clientId: string): ParsedImport {
  const client = ALL_CLIENTS.find((c) => c.id === clientId);
  return client ? scanClient(client) : EMPTY;
}
