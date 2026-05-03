import path from "node:path";
import os from "node:os";

export type ClientFormat = "json" | "toml";

export interface ClientMeta {
  id: string;
  name: string;
  configPathSegments: string[][];
  format: ClientFormat;
  topLevelKey: string;
  description: string;
}

export function resolveConfigPaths(client: ClientMeta): string[] {
  const home = os.homedir();
  return client.configPathSegments.map((segments) => path.join(home, ...segments));
}

export const ALL_CLIENTS: readonly ClientMeta[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    configPathSegments: [[".claude", "settings.json"]],
    format: "json",
    topLevelKey: "mcpServers",
    description: "Add to ~/.claude/settings.json → mcpServers",
  },
  {
    id: "codex",
    name: "Codex",
    configPathSegments: [[".codex", "config.toml"]],
    format: "toml",
    topLevelKey: "mcp_servers",
    description: "Add to ~/.codex/config.toml or project .codex/config.toml",
  },
  {
    id: "opencode",
    name: "OpenCode",
    configPathSegments: [
      [".config", "opencode", "opencode.json"],
      [".config", "opencode", "opencode.jsonc"],
    ],
    format: "json",
    topLevelKey: "mcp",
    description: "Add to ~/.config/opencode/opencode.json or project opencode.json",
  },
  {
    id: "cursor",
    name: "Cursor",
    configPathSegments: [[".cursor", "mcp.json"]],
    format: "json",
    topLevelKey: "mcpServers",
    description: "Add to ~/.cursor/mcp.json or project .cursor/mcp.json",
  },
] as const;

const CLIENT_MAP = new Map(ALL_CLIENTS.map((c) => [c.id, c]));

export function getClientById(id: string): ClientMeta | undefined {
  return CLIENT_MAP.get(id);
}
