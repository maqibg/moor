import type { Database } from "./index.js";
import { getDatabase } from "./index.js";
import { parseJsonValue, keysToCamelCase } from "./serializers.js";

export interface ToolDiscoveryRow {
  serverId: string;
  toolName: string;
  exposedName: string;
  description: string | null;
  inputSchema: unknown;
  discoveredAt: string;
}

function serializeToolDiscovery(row: Record<string, unknown>): ToolDiscoveryRow {
  const inputSchema =
    "inputSchema" in row ? row.inputSchema : parseJsonValue(row.input_schema, undefined);
  const camel = keysToCamelCase({
    ...row,
    input_schema: inputSchema,
  });
  return {
    serverId: String(camel.serverId),
    toolName: String(camel.toolName),
    exposedName: String(camel.exposedName),
    description: (camel.description ?? null) as string | null,
    inputSchema: camel.inputSchema,
    discoveredAt: String(camel.discoveredAt),
  };
}

export class ToolDiscoveryRepository {
  constructor(private db: Database) {}

  findByServerId(serverId: string): ToolDiscoveryRow[] {
    return this.db
      .queryAll("SELECT * FROM tool_discoveries WHERE server_id = ?", [serverId])
      .map(serializeToolDiscovery);
  }

  replaceToolsForServer(
    serverId: string,
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  ): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM tool_discoveries WHERE server_id = ?", [serverId]);
      const now = new Date().toISOString();
      for (const tool of tools) {
        this.db.run(
          "INSERT INTO tool_discoveries (server_id, tool_name, exposed_name, description, input_schema, discovered_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            serverId,
            tool.name,
            tool.name,
            tool.description ?? null,
            tool.inputSchema ? JSON.stringify(tool.inputSchema) : null,
            now,
          ],
        );
      }
    });
  }

  deleteByServerId(serverId: string): void {
    this.db.run("DELETE FROM tool_discoveries WHERE server_id = ?", [serverId]);
  }

  findByProfileId(profileId: string): Array<{
    serverId: string;
    serverName: string;
    disabledTools: string[];
    toolName: string;
    description: string | null;
    inputSchema: unknown;
  }> {
    return this.db
      .queryAll(
        `SELECT
          ps.server_id,
          ms.name AS server_name,
          ps.disabled_tools,
          td.tool_name,
          td.description,
          td.input_schema
        FROM profile_servers ps
        JOIN mcp_servers ms ON ps.server_id = ms.id
        JOIN tool_discoveries td ON td.server_id = ms.id
        WHERE ps.profile_id = ? AND ps.enabled = 1
        ORDER BY ms.name ASC, td.tool_name ASC`,
        [profileId],
      )
      .map((row) => ({
        serverId: String(row.server_id),
        serverName: String(row.server_name),
        disabledTools: parseJsonValue(row.disabled_tools, []) as string[],
        toolName: String(row.tool_name),
        description: (row.description ?? null) as string | null,
        inputSchema: parseJsonValue(row.input_schema, undefined),
      }));
  }

  findDisabledToolsForServer(profileId: string | undefined, serverId: string): Set<string> {
    const rows = profileId
      ? this.db.queryAll(
          "SELECT disabled_tools FROM profile_servers WHERE profile_id = ? AND server_id = ?",
          [profileId, serverId],
        )
      : this.db.queryAll("SELECT disabled_tools FROM profile_servers WHERE server_id = ?", [
          serverId,
        ]);
    return new Set(
      rows.flatMap((row) => {
        try {
          return JSON.parse(row.disabled_tools as string) as string[];
        } catch {
          return [];
        }
      }),
    );
  }
}

export function getToolDiscoveryRepository(): ToolDiscoveryRepository {
  return new ToolDiscoveryRepository(getDatabase());
}
