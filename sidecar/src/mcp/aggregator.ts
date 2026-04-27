import { serverManager } from "../services/server-manager.js";
import { queryOne } from "../db/index.js";
import type { MCPTool } from "./types.js";

export class Aggregator {
  getAggregatedTools(): Array<MCPTool & { serverId: string; serverName: string; rawName: string }> {
    return serverManager.getToolCatalog().map((tool) => ({
      name: tool.exposedName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      serverId: tool.serverId,
      serverName: tool.serverName,
      rawName: tool.toolName,
    }));
  }

  findToolOwner(
    toolName: string,
  ): { serverId: string; serverName: string; toolName: string } | null {
    const owner = serverManager.findToolOwner(toolName);
    return owner
      ? { serverId: owner.serverId, serverName: owner.serverName, toolName: owner.toolName }
      : null;
  }

  getActiveProfileId(): string | null {
    const row = queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
    return (row?.id as string) ?? null;
  }
}

export const aggregator = new Aggregator();
