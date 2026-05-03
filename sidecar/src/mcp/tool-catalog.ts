export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCatalogRow {
  serverId: string;
  serverName: string;
  disabledTools: string[];
  toolName: string;
  description: string | null;
  inputSchema: unknown;
}

export interface ToolCatalogEntry {
  serverId: string;
  serverName: string;
  toolName: string;
  exposedName: string;
  description?: string;
  inputSchema?: MCPTool["inputSchema"];
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
  const counts = new Map<string, number>();
  for (const row of enabledRows) {
    counts.set(row.toolName, (counts.get(row.toolName) ?? 0) + 1);
  }

  return enabledRows.map((row) => {
    const duplicate = (counts.get(row.toolName) ?? 0) > 1;
    return {
      serverId: row.serverId,
      serverName: row.serverName,
      toolName: row.toolName,
      exposedName: duplicate
        ? `${normalizeServerName(row.serverName)}__${row.toolName}`
        : row.toolName,
      description: row.description ?? undefined,
      inputSchema: row.inputSchema as MCPTool["inputSchema"] | undefined,
    };
  });
}
