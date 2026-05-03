import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseCodexTomlConfig, parseJsonMcpConfig, type ParsedImport } from "./import-parser.js";

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
  parser: (content: string, source: string) => ParsedImport,
): ParsedImport {
  const content = readFileIfExists(configPath);
  if (!content) return EMPTY;
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

function scanClaudeCodeConfig(): ParsedImport {
  return parseConfigFile(
    path.join(os.homedir(), ".claude", "settings.json"),
    "claude-code",
    parseJsonMcpConfig,
  );
}

function scanCodexConfig(): ParsedImport {
  return parseConfigFile(
    path.join(os.homedir(), ".codex", "config.toml"),
    "codex",
    parseCodexTomlConfig,
  );
}

function scanOpenCodeConfig(): ParsedImport {
  const candidates = [
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    path.join(os.homedir(), ".config", "opencode", "opencode.jsonc"),
  ];
  const results = candidates.map((p) => parseConfigFile(p, "opencode", parseJsonMcpConfig));
  const merged = mergeParsed(...results);

  const seen = new Set<string>();
  merged.servers = merged.servers.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  return merged;
}

function scanCursorConfig(): ParsedImport {
  return parseConfigFile(
    path.join(os.homedir(), ".cursor", "mcp.json"),
    "cursor",
    parseJsonMcpConfig,
  );
}

export function scanAllConfigs(): ParsedImport {
  return mergeParsed(
    scanClaudeCodeConfig(),
    scanCodexConfig(),
    scanOpenCodeConfig(),
    scanCursorConfig(),
  );
}

export function scanClientConfig(clientId: string): ParsedImport {
  const scanners: Record<string, () => ParsedImport> = {
    "claude-code": scanClaudeCodeConfig,
    codex: scanCodexConfig,
    opencode: scanOpenCodeConfig,
    cursor: scanCursorConfig,
  };
  const scanner = scanners[clientId];
  return scanner ? scanner() : EMPTY;
}
