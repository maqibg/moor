import type { MCPTool } from "./types.js";
import { serverManager } from "../services/server-manager.js";
import { queryAll, queryOne } from "../db/index.js";

export class Aggregator {
  getAggregatedTools(): Array<MCPTool & { serverId: string; serverName: string }> {
    const activeServers = serverManager.getActiveProfileServers();
    const allTools: Array<MCPTool & { serverId: string; serverName: string }> = [];

    for (const { serverId, server, disabledTools } of activeServers) {
      const discovered = queryAll("SELECT tool_name, description, input_schema FROM tool_discoveries WHERE server_id = ?", [serverId]);

      for (const tool of discovered) {
        if (disabledTools.includes(tool.tool_name as string)) continue;
        allTools.push({
          name: tool.tool_name as string,
          description: (tool.description as string) ?? undefined,
          inputSchema: tool.input_schema ? JSON.parse(tool.input_schema as string) : undefined,
          serverId,
          serverName: server.name,
        });
      }
    }

    return allTools;
  }

  findToolOwner(toolName: string): { serverId: string; serverName: string } | null {
    const activeServers = serverManager.getActiveProfileServers();

    for (const { serverId, server, disabledTools } of activeServers) {
      if (disabledTools.includes(toolName)) continue;
      const tool = queryOne("SELECT tool_name FROM tool_discoveries WHERE server_id = ? AND tool_name = ?", [serverId, toolName]);
      if (tool) return { serverId, serverName: server.name };
    }

    return null;
  }

  getActiveProfileId(): string | null {
    const row = queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
    return (row?.id as string) ?? null;
  }
}

export const aggregator = new Aggregator();
