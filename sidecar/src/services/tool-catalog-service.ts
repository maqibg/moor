import { getToolDiscoveryRepository } from "../db/tool-discovery-repository.js";
import { getProfileRepository } from "../db/profile-repository.js";
import { buildToolCatalogFromRows, type ToolCatalogRow } from "../db/tool-catalog.js";
import type { ToolCatalogEntry } from "@moor/types";

export class ToolCatalogService {
  getToolCatalog(profileId?: string | null): ToolCatalogEntry[] {
    const activeProfileId = profileId ?? getProfileRepository().findActiveId();
    if (!activeProfileId) return [];

    const rows = getToolDiscoveryRepository().findByProfileId(activeProfileId);
    return buildToolCatalogFromRows(
      rows.map(
        (row) =>
          ({
            serverId: row.serverId,
            serverName: row.serverName,
            disabledTools: row.disabledTools,
            toolName: row.toolName,
            description: row.description,
            inputSchema: row.inputSchema,
          }) satisfies ToolCatalogRow,
      ),
    );
  }

  findToolOwner(exposedName: string): ToolCatalogEntry | null {
    return this.getToolCatalog().find((tool) => tool.exposedName === exposedName) ?? null;
  }

  getDiscoveredTools(serverId: string) {
    return getToolDiscoveryRepository().findByServerId(serverId);
  }

  getToolDetails(serverId: string, profileId?: string) {
    const catalog = this.getToolCatalog(profileId);
    const disabledForServer = getToolDiscoveryRepository().findDisabledToolsForServer(
      profileId,
      serverId,
    );
    return this.getDiscoveredTools(serverId).map((row) => {
      const catalogEntry = catalog.find(
        (tool) => tool.serverId === serverId && tool.toolName === row.toolName,
      );
      return {
        ...row,
        exposedName: catalogEntry?.exposedName ?? row.toolName,
        disabled: disabledForServer.has(row.toolName),
      };
    });
  }
}

export const toolCatalogService = new ToolCatalogService();
