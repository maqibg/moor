import type { ScannedServer } from "./import-parser.js";
import type { ClientMeta } from "./clients.js";

export interface FormatResult {
  content: string;
  warnings: string[];
}

interface EnvHeaderRef {
  prefix: string;
  name: string;
  suffix: string;
}

interface CodexHeaderParts {
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Record<string, string>;
  httpHeaders?: Record<string, string>;
  unconvertedEnvHeaders: string[];
}

function nonEmpty(obj: Record<string, string> | undefined): obj is Record<string, string> {
  return !!obj && Object.keys(obj).length > 0;
}

function parseEnvHeaderRef(value: string): EnvHeaderRef | null {
  const patterns = [
    /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/,
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/,
    /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (!match?.[1] || match.index === undefined) continue;
    return {
      prefix: value.slice(0, match.index),
      name: match[1],
      suffix: value.slice(match.index + match[0].length),
    };
  }

  return null;
}

function envRefForClient(name: string, client: ClientMeta): string {
  switch (client.id) {
    case "claude-code":
      return `\${${name}}`;
    case "cursor":
      return `\${env:${name}}`;
    case "opencode":
      return `{env:${name}}`;
    default:
      return `{env:${name}}`;
  }
}

function rewriteHeaderValue(value: string, client: ClientMeta): string {
  const ref = parseEnvHeaderRef(value);
  if (!ref) return value;
  return `${ref.prefix}${envRefForClient(ref.name, client)}${ref.suffix}`;
}

function rewriteHeaders(
  headers: Record<string, string> | undefined,
  client: ClientMeta,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, rewriteHeaderValue(value, client)]),
  );
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
  return `{ ${Object.entries(values)
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
    .join(", ")} }`;
}

function codexHeaderParts(headers: Record<string, string> | undefined): CodexHeaderParts {
  const parts: CodexHeaderParts = { unconvertedEnvHeaders: [] };
  if (!headers) return parts;

  const envHttpHeaders: Record<string, string> = {};
  const httpHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const ref = parseEnvHeaderRef(value);
    const isAuthorization = key.toLowerCase() === "authorization";
    if (isAuthorization && ref?.prefix === "Bearer " && ref.suffix === "") {
      parts.bearerTokenEnvVar = ref.name;
      continue;
    }

    if (ref?.prefix === "" && ref.suffix === "") {
      envHttpHeaders[key] = ref.name;
      continue;
    }

    httpHeaders[key] = value;
    if (ref) parts.unconvertedEnvHeaders.push(key);
  }

  if (Object.keys(envHttpHeaders).length > 0) parts.envHttpHeaders = envHttpHeaders;
  if (Object.keys(httpHeaders).length > 0) parts.httpHeaders = httpHeaders;

  return parts;
}

function buildWarnings(servers: ScannedServer[], target: ClientMeta): string[] {
  const warnings: string[] = [];

  if (servers.some((s) => nonEmpty(s.headers)) && target.id === "codex") {
    warnings.push("Headers 已映射为 Codex 的 http_headers/env_http_headers，请手动检查");
  }

  const unconvertedCodexHeaders = servers.flatMap((s) =>
    target.id === "codex" ? codexHeaderParts(s.headers).unconvertedEnvHeaders : [],
  );
  if (unconvertedCodexHeaders.length > 0) {
    warnings.push(
      `以下 Header 包含 Codex 无法无损表达的环境变量组合，已保留原值：${unconvertedCodexHeaders.join(", ")}`,
    );
  }

  if (servers.some((s) => s.workingDir) && (target.id === "opencode" || target.id === "cursor")) {
    warnings.push(`${target.name} 不原生支持 workingDir 字段，已忽略`);
  }

  if (servers.some((s) => nonEmpty(s.env)) && target.id === "opencode") {
    warnings.push("环境变量已映射为 environment 字段");
  }

  return warnings;
}

function stdioEntry(server: ScannedServer, client: ClientMeta): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  if (client.id === "opencode") {
    entry.type = "local";
    entry.command = server.args?.length ? [server.command!, ...server.args] : [server.command!];
    if (nonEmpty(server.env)) entry.environment = server.env;
    return entry;
  }

  if (client.id === "cursor") {
    entry.type = "stdio";
  }
  entry.command = server.command;
  if (server.args?.length) entry.args = server.args;
  if (nonEmpty(server.env)) entry.env = server.env;

  return entry;
}

function httpEntry(server: ScannedServer, client: ClientMeta): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  if (client.id === "opencode") {
    entry.type = "remote";
    entry.url = server.url;
    const headers = rewriteHeaders(server.headers, client);
    if (nonEmpty(headers)) entry.headers = headers;
    return entry;
  }

  entry.url = server.url;
  const headers = rewriteHeaders(server.headers, client);
  if (nonEmpty(headers)) {
    entry[client.id === "codex" ? "http_headers" : "headers"] = headers;
  }

  return entry;
}

function formatJsonMcpServers(
  servers: ScannedServer[],
  client: ClientMeta,
  topLevelKey: string,
  extraWarnings?: string[],
): FormatResult {
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    mcpServers[s.name] =
      s.connectionType === "stdio" ? stdioEntry(s, client) : httpEntry(s, client);
  }
  const warnings = buildWarnings(servers, client);
  if (extraWarnings) warnings.push(...extraWarnings);
  return {
    content: JSON.stringify({ [topLevelKey]: mcpServers }, null, 2),
    warnings,
  };
}

export function formatForClaudeCode(servers: ScannedServer[], client: ClientMeta): FormatResult {
  return formatJsonMcpServers(servers, client, "mcpServers");
}

export function formatForCodex(servers: ScannedServer[], client: ClientMeta): FormatResult {
  const lines: string[] = [];
  for (const s of servers) {
    lines.push(`[mcp_servers.${tomlKey(s.name)}]`);
    if (s.connectionType === "stdio") {
      lines.push(`command = ${tomlString(s.command ?? "")}`);
      if (s.args?.length) lines.push(`args = ${tomlArray(s.args)}`);
      const env = s.env;
      if (nonEmpty(env)) lines.push(`env = ${tomlInlineTable(env)}`);
      if (s.workingDir) lines.push(`cwd = ${tomlString(s.workingDir)}`);
    } else {
      lines.push(`url = ${tomlString(s.url ?? "")}`);
      const headers = codexHeaderParts(s.headers);
      if (headers.bearerTokenEnvVar) {
        lines.push(`bearer_token_env_var = ${tomlString(headers.bearerTokenEnvVar)}`);
      }
      if (headers.httpHeaders) lines.push(`http_headers = ${tomlInlineTable(headers.httpHeaders)}`);
      if (headers.envHttpHeaders) {
        lines.push(`env_http_headers = ${tomlInlineTable(headers.envHttpHeaders)}`);
      }
    }
    lines.push("enabled = true");
    lines.push("");
  }
  return {
    content: lines.join("\n").trimEnd(),
    warnings: buildWarnings(servers, client),
  };
}

export function formatForOpenCode(servers: ScannedServer[], client: ClientMeta): FormatResult {
  const result = formatJsonMcpServers(servers, client, "mcp");
  // Add $schema and enabled flag
  const parsed = JSON.parse(result.content) as Record<string, unknown>;
  const mcp = parsed.mcp as Record<string, unknown>;
  for (const key of Object.keys(mcp)) {
    (mcp[key] as Record<string, unknown>).enabled = true;
  }
  parsed.$schema = "https://opencode.ai/config.json";
  result.content = JSON.stringify(parsed, null, 2);
  return result;
}

export function formatForCursor(servers: ScannedServer[], client: ClientMeta): FormatResult {
  const httpServers = servers.filter((s) => s.connectionType === "http");
  const extraWarnings =
    httpServers.length > 0
      ? ['HTTP 服务器默认使用 streamable-http 传输。如需 SSE，请将 type 字段改为 "sse"']
      : [];

  return formatJsonMcpServers(servers, client, "mcpServers", extraWarnings);
}

export const FORMATTERS: Record<
  string,
  (servers: ScannedServer[], client: ClientMeta) => FormatResult
> = {
  "claude-code": formatForClaudeCode,
  codex: formatForCodex,
  opencode: formatForOpenCode,
  cursor: formatForCursor,
};
