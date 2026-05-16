import type { MCPTool, ToolCatalogEntry } from "@moor/types";

export interface ToolCatalogRow {
  serverId: string;
  serverName: string;
  disabledTools: string[];
  toolName: string;
  description: string | null;
  inputSchema: unknown;
}

export function normalizeServerName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "server"
  );
}

export function buildToolCatalogFromRows(rows: ToolCatalogRow[]): ToolCatalogEntry[] {
  const enabledRows = rows.filter((row) => !row.disabledTools.includes(row.toolName));
  const serverIdsByBaseName = new Map<string, string[]>();
  for (const row of enabledRows) {
    const baseName = `${normalizeServerName(row.serverName)}__${row.toolName}`;
    const serverIds = serverIdsByBaseName.get(baseName) ?? [];
    serverIds.push(row.serverId);
    serverIdsByBaseName.set(baseName, serverIds);
  }

  return enabledRows.map((row) => {
    const serverSlug = normalizeServerName(row.serverName);
    const baseName = `${serverSlug}__${row.toolName}`;
    const serverIds = serverIdsByBaseName.get(baseName) ?? [];
    return {
      serverId: row.serverId,
      serverName: row.serverName,
      toolName: row.toolName,
      exposedName:
        serverIds.length > 1
          ? `${serverSlug}_${shortestUniqueServerIdPrefix(row.serverId, serverIds)}__${row.toolName}`
          : baseName,
      description: row.description ?? undefined,
      inputSchema: row.inputSchema as MCPTool["inputSchema"] | undefined,
    };
  });
}

function shortestUniqueServerIdPrefix(serverId: string, serverIds: string[]): string {
  for (let length = Math.min(8, serverId.length); length <= serverId.length; length += 1) {
    const prefix = serverId.slice(0, length);
    if (serverIds.every((candidate) => candidate === serverId || !candidate.startsWith(prefix))) {
      return prefix;
    }
  }
  return serverId;
}
