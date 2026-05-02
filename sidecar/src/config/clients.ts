import path from "node:path";
import os from "node:os";

export type ClientFormat = "json" | "toml";

export interface ClientMeta {
  id: string;
  name: string;
  configPath: string;
  format: ClientFormat;
  topLevelKey: string;
  description: string;
}

export const ALL_CLIENTS: readonly ClientMeta[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    configPath: path.join(os.homedir(), ".claude", "settings.json"),
    format: "json",
    topLevelKey: "mcpServers",
    description: "Add to ~/.claude/settings.json → mcpServers",
  },
  {
    id: "codex",
    name: "Codex",
    configPath: path.join(os.homedir(), ".codex", "config.toml"),
    format: "toml",
    topLevelKey: "mcp_servers",
    description: "Add to ~/.codex/config.toml or project .codex/config.toml",
  },
  {
    id: "opencode",
    name: "OpenCode",
    configPath: path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    format: "json",
    topLevelKey: "mcp",
    description: "Add to ~/.config/opencode/opencode.json or project opencode.json",
  },
  {
    id: "cursor",
    name: "Cursor",
    configPath: path.join(os.homedir(), ".cursor", "mcp.json"),
    format: "json",
    topLevelKey: "mcpServers",
    description: "Add to ~/.cursor/mcp.json or project .cursor/mcp.json",
  },
] as const;

const CLIENT_MAP = new Map(ALL_CLIENTS.map((c) => [c.id, c]));

export function getClientById(id: string): ClientMeta | undefined {
  return CLIENT_MAP.get(id);
}
