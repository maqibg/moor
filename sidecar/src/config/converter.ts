import { getClientById } from "./clients.js";
import { scanClientConfig } from "./scanner.js";
import {
  parseJsonMcpConfig,
  parseCodexTomlConfig,
  type ParsedImport,
  type ScannedServer,
} from "./import-parser.js";
import { FORMATTERS } from "./formatters.js";
import { queryAll } from "../db/index.js";

export interface ConvertInput {
  source: "moor" | "scan" | "paste";
  sourceClient?: string;
  content?: string;
  serverIds?: string[];
  targetClient: string;
}

export interface ConvertResult {
  content: string;
  warnings: string[];
  targetPath: string;
  targetClient: string;
}

interface ResolvedSource {
  servers: ScannedServer[];
  warnings: string[];
}

function safeJsonParse(value: string | null | undefined): unknown | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
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
    targetPath: target.configPath,
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

  const rows = queryAll(
    `SELECT id, name, connection_type, command, args, url, env, headers, working_dir
     FROM mcp_servers WHERE id IN (${serverIds.map(() => "?").join(",")})`,
    serverIds,
  );

  return rows.map((row) => {
    const connectionType = row.connection_type as "stdio" | "http";
    const base: ScannedServer = {
      name: row.name as string,
      connectionType,
      source: "moor",
    };

    if (connectionType === "stdio") {
      base.command = row.command as string | undefined;
      base.args = safeJsonParse(row.args as string) as string[] | undefined;
    } else {
      base.url = row.url as string | undefined;
      base.headers = safeJsonParse(row.headers as string) as Record<string, string> | undefined;
    }

    base.env = safeJsonParse(row.env as string) as Record<string, string> | undefined;
    base.workingDir = row.working_dir as string | undefined;

    return base;
  });
}

function parsedImportWarnings(parsed: ParsedImport): string[] {
  return [
    ...parsed.errors.map((error) => `解析错误：${error}`),
    ...parsed.unsupported.map(
      (server) => `已跳过不支持的 server "${server.name}"：${server.reason}`,
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
