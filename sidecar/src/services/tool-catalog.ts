import { run, queryAll, transaction } from "../db/index.js";
import { parseJsonValue, serializeToolDiscovery } from "../db/serializers.js";
import { buildToolCatalogFromRows, type ToolCatalogRow } from "../mcp/tool-catalog.js";
import { profileService } from "./profiles.js";
import { eventBus } from "./event-bus.js";
import type { ToolCatalogEntry } from "@moor/types";

class ToolCatalogService {
  cacheTools(
    serverId: string,
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  ) {
    transaction(() => {
      run("DELETE FROM tool_discoveries WHERE server_id = ?", [serverId]);
      const now = new Date().toISOString();
      for (const tool of tools) {
        run(
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
    eventBus.emit("server:tools", { type: "server:tools", data: { serverId, tools } });
  }

  getDiscoveredTools(serverId: string) {
    return queryAll("SELECT * FROM tool_discoveries WHERE server_id = ?", [serverId]).map(
      serializeToolDiscovery,
    );
  }

  getToolCatalog(profileId?: string | null): ToolCatalogEntry[] {
    const activeProfileId = profileId ?? profileService.getActiveProfileId();
    if (!activeProfileId) return [];

    const rows = queryAll(
      `
      SELECT
        ps.server_id AS serverId,
        ms.name AS serverName,
        ps.disabled_tools AS disabledTools,
        td.tool_name AS toolName,
        td.description AS description,
        td.input_schema AS inputSchema
      FROM profile_servers ps
      JOIN mcp_servers ms ON ps.server_id = ms.id
      JOIN tool_discoveries td ON td.server_id = ms.id
      WHERE ps.profile_id = ? AND ps.enabled = 1
      ORDER BY ms.name ASC, td.tool_name ASC
    `,
      [activeProfileId],
    );

    return buildToolCatalogFromRows(
      rows.map(
        (row) =>
          ({
            serverId: row.serverId as string,
            serverName: row.serverName as string,
            disabledTools: parseJsonValue(row.disabledTools, []) as string[],
            toolName: row.toolName as string,
            description: row.description as string | null,
            inputSchema: parseJsonValue(row.inputSchema, undefined),
          }) satisfies ToolCatalogRow,
      ),
    );
  }

  findToolOwner(exposedName: string): ToolCatalogEntry | null {
    return this.getToolCatalog().find((tool) => tool.exposedName === exposedName) ?? null;
  }
}

export const toolCatalogService = new ToolCatalogService();
