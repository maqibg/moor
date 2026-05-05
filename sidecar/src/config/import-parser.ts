import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import type { ScannedServer, UnsupportedServer, ImportDiagnostic, ParsedImport } from "@moor/types";

export type { ScannedServer, UnsupportedServer, ImportDiagnostic, ParsedImport };

const HTTP_TYPES = new Set(["http", "sse", "streamable-http", "streamable_http", "remote"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === "string");
  return values.length === value.length ? values : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, item]) => {
      if (typeof item === "string") return [key, item] as const;
      if (typeof item === "number" || typeof item === "boolean") {
        return [key, String(item)] as const;
      }
      return null;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function asHeaderRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, item]) => {
      if (typeof item === "string") return [key, item] as const;
      if (isRecord(item) && typeof item.env === "string") {
        return [key, `{env:${item.env}}`] as const;
      }
      return null;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function envHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, item]): [string, string] | null =>
      typeof item === "string" ? [key, `{env:${item}}`] : null,
    )
    .filter((entry): entry is [string, string] => entry !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function mergeRecords(
  ...records: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged: Record<string, string> = Object.assign({}, ...records.filter(Boolean));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeServer(
  name: string,
  rawConfig: Record<string, unknown>,
  source: string,
): ScannedServer | UnsupportedServer | null {
  if (rawConfig.enabled === false) return null;

  const type = asString(rawConfig.type)?.toLowerCase();
  if (type === "openapi" || rawConfig.openapi) {
    return { name, source, reason: "OpenAPI-to-MCP is not supported" };
  }

  const commandArray = asStringArray(rawConfig.command);
  const command = asString(rawConfig.command) ?? commandArray?.[0];
  const args = commandArray?.slice(1) ?? asStringArray(rawConfig.args);
  const url = asString(rawConfig.url);
  const env = asStringRecord(rawConfig.env) ?? asStringRecord(rawConfig.environment);
  const workingDir =
    asString(rawConfig.cwd) ?? asString(rawConfig.workingDir) ?? asString(rawConfig.working_dir);
  const bearerTokenEnv = asString(rawConfig.bearer_token_env_var);
  const headers = mergeRecords(
    asHeaderRecord(rawConfig.headers),
    asHeaderRecord(rawConfig.http_headers),
    envHeaders(rawConfig.env_http_headers),
    bearerTokenEnv ? { Authorization: `Bearer {env:${bearerTokenEnv}}` } : undefined,
  );

  if (type === "local" || type === "stdio" || command) {
    if (!command) return { name, source, reason: "stdio server is missing a command" };
    return {
      name,
      connectionType: "stdio",
      command,
      args,
      env,
      workingDir,
      source,
    };
  }

  if (url && (!type || HTTP_TYPES.has(type))) {
    return {
      name,
      connectionType: "http",
      url,
      headers,
      source,
    };
  }

  if (type && !HTTP_TYPES.has(type)) {
    return { name, source, reason: `unsupported server type "${type}"` };
  }

  return { name, source, reason: "config is missing command or url" };
}

function parseServerMap(value: unknown, source: string): ParsedImport {
  const servers: ScannedServer[] = [];
  const unsupported: UnsupportedServer[] = [];

  if (!isRecord(value)) {
    return {
      servers,
      unsupported,
      errors: [`${source}: no valid server map found`],
      diagnostics: [],
    };
  }

  for (const [name, rawConfig] of Object.entries(value)) {
    if (!isRecord(rawConfig)) {
      unsupported.push({ name, source, reason: "server config must be an object" });
      continue;
    }

    const normalized = normalizeServer(name, rawConfig, source);
    if (!normalized) continue;
    if ("connectionType" in normalized) servers.push(normalized);
    else unsupported.push(normalized);
  }

  return { servers, unsupported, errors: [], diagnostics: [] };
}

function mergeParsed(...results: ParsedImport[]): ParsedImport {
  return {
    servers: results.flatMap((result) => result.servers),
    unsupported: results.flatMap((result) => result.unsupported),
    errors: results.flatMap((result) => result.errors),
    diagnostics: results.flatMap((result) => result.diagnostics),
  };
}

function lineColumnAtOffset(content: string, offset: number): { line: number; column: number } {
  const previousLineBreak = content.lastIndexOf("\n", Math.max(0, offset - 1));
  return {
    line: content.slice(0, offset).split("\n").length,
    column: offset - previousLineBreak,
  };
}

function toJsonDiagnostic(source: string, content: string, error: ParseError): ImportDiagnostic {
  const position = lineColumnAtOffset(content, error.offset);
  const code = printParseErrorCode(error.error);
  return {
    source,
    message: code,
    code,
    line: position.line,
    column: position.column,
    offset: error.offset,
    length: error.length,
  };
}

export function parseJsonMcpConfig(content: string, source: string): ParsedImport {
  const errors: ParseError[] = [];
  const config = parseJsonc(content, errors, { allowTrailingComma: true }) as unknown;
  if (errors.length > 0) {
    const diagnostics = errors.map((error) => toJsonDiagnostic(source, content, error));
    const first = diagnostics[0];
    return {
      servers: [],
      unsupported: [],
      errors: [
        first?.line && first.column
          ? `${source}: JSON parse error at line ${first.line}, column ${first.column}`
          : `${source}: JSON parse error`,
      ],
      diagnostics,
    };
  }
  if (!isRecord(config)) {
    return {
      servers: [],
      unsupported: [],
      errors: [`${source}: config root must be an object`],
      diagnostics: [],
    };
  }

  const results: ParsedImport[] = [];
  if ("mcpServers" in config) results.push(parseServerMap(config.mcpServers, source));
  if ("mcp" in config) results.push(parseServerMap(config.mcp, source));

  return results.length > 0
    ? mergeParsed(...results)
    : {
        servers: [],
        unsupported: [],
        errors: [`${source}: no mcpServers or mcp key found`],
        diagnostics: [],
      };
}

export function parseCodexTomlConfig(content: string, source: string): ParsedImport {
  try {
    const config = parseToml(content) as unknown;
    if (!isRecord(config)) {
      return {
        servers: [],
        unsupported: [],
        errors: [`${source}: TOML root must be an object`],
        diagnostics: [],
      };
    }
    if (!("mcp_servers" in config)) {
      return {
        servers: [],
        unsupported: [],
        errors: [`${source}: no mcp_servers key found`],
        diagnostics: [],
      };
    }
    return parseServerMap(config.mcp_servers, source);
  } catch {
    return {
      servers: [],
      unsupported: [],
      errors: [`${source}: TOML parse error`],
      diagnostics: [],
    };
  }
}
