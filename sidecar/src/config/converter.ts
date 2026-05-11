import { getClientById, resolveConfigPaths } from "./clients.js";
import { scanClientConfig } from "./scanner.js";
import {
  parseJsonMcpConfig,
  parseCodexTomlConfig,
  type ParsedImport,
  type ScannedServer,
} from "./import-parser.js";
import { FORMATTERS } from "./formatters.js";
import { getServerRepository } from "../db/server-repository.js";
import type { ConvertResult } from "@moor/types";
export type { ConvertResult } from "@moor/types";

export interface ConvertInput {
  source: "moor" | "scan" | "paste";
  sourceClient?: string;
  content?: string;
  serverIds?: string[];
  targetClient: string;
}

interface ResolvedSource {
  servers: ScannedServer[];
  warnings: string[];
}

export function convertConfig(input: ConvertInput): ConvertResult {
  const target = getClientById(input.targetClient);
  if (!target) throw new Error(`Unknown target client: ${input.targetClient}`);

  const source = resolveSourceServers(input);
  if (source.servers.length === 0) {
    if (source.warnings.length > 0) {
      throw new Error(source.warnings.join("; "));
    }
    throw new Error("No servers found to convert");
  }

  const formatter = FORMATTERS[target.id];
  if (!formatter) throw new Error(`No formatter for client: ${target.id}`);

  const { content, warnings } = formatter(source.servers, target);

  return {
    content,
    warnings: [...source.warnings, ...warnings],
    targetPath: resolveConfigPaths(target)[0],
    targetClient: target.id,
  };
}

function resolveSourceServers(input: ConvertInput): ResolvedSource {
  switch (input.source) {
    case "moor":
      return { servers: resolveFromMoor(input.serverIds ?? []), warnings: [] };
    case "scan":
      return resolveFromScan(input.sourceClient ?? "");
    case "paste":
      return resolveFromPaste(input.content ?? "", input.sourceClient ?? "");
  }
}

function resolveFromMoor(serverIds: string[]): ScannedServer[] {
  if (serverIds.length === 0) return [];

  const rows = getServerRepository().findByIds(serverIds);

  return rows.map((row) => {
    const connectionType = row.connectionType;
    const base: ScannedServer = {
      name: row.name,
      connectionType,
      source: "moor",
    };

    if (connectionType === "stdio") {
      base.command = row.command ?? undefined;
      base.args = row.args ?? undefined;
    } else {
      base.url = row.url ?? undefined;
      base.headers = row.headers ?? undefined;
    }

    base.env = row.env ?? undefined;
    base.workingDir = row.workingDir ?? undefined;

    return base;
  });
}

function parsedImportWarnings(parsed: ParsedImport): string[] {
  return [
    ...parsed.errors.map((error) => `Parse error: ${error}`),
    ...parsed.unsupported.map(
      (server) => `Skipped unsupported server "${server.name}": ${server.reason}`,
    ),
  ];
}

function resolveFromScan(sourceClient: string): ResolvedSource {
  if (!sourceClient) return { servers: [], warnings: [] };
  const parsed = scanClientConfig(sourceClient);
  return {
    servers: parsed.servers,
    warnings: parsedImportWarnings(parsed),
  };
}

function resolveFromPaste(content: string, sourceClient: string): ResolvedSource {
  if (!content.trim()) return { servers: [], warnings: [] };

  const client = sourceClient ? getClientById(sourceClient) : null;
  const source = sourceClient || "paste";

  let parsed: ParsedImport;
  if (client?.format === "toml") {
    parsed = parseCodexTomlConfig(content, source);
  } else {
    parsed = parseJsonMcpConfig(content, source);
  }

  return {
    servers: parsed.servers,
    warnings: parsedImportWarnings(parsed),
  };
}
