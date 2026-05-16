import { getToolDiscoveryRepository } from "../db/tool-discovery-repository.js";
import { getProfileRepository } from "../db/profile-repository.js";
import { getServerRepository } from "../db/server-repository.js";
import {
  buildToolCatalogFromRows,
  normalizeServerName,
  type ToolCatalogRow,
} from "../db/tool-catalog.js";
import type { ToolCatalogEntry } from "@moor/types";

interface ToolCatalogOptions {
  serverIds?: ReadonlySet<string>;
}

export class ToolCatalogService {
  getToolCatalog(profileId?: string | null, options: ToolCatalogOptions = {}): ToolCatalogEntry[] {
    const activeProfileId = profileId ?? getProfileRepository().findActiveId();
    if (!activeProfileId) return [];

    const rows = getToolDiscoveryRepository().findByProfileId(activeProfileId);
    const visibleServerIds = options.serverIds;
    const visibleRows = visibleServerIds
      ? rows.filter((row) => visibleServerIds.has(row.serverId))
      : rows;
    return buildToolCatalogFromRows(
      visibleRows.map(
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

  getToolDetails(serverId: string, profileId?: string, options: ToolCatalogOptions = {}) {
    const serverName = getServerRepository().findById(serverId)?.name;
    const catalog = this.getToolCatalog(profileId, options);
    const disabledForServer = getToolDiscoveryRepository().findDisabledToolsForServer(
      profileId,
      serverId,
    );
    const slug = normalizeServerName(serverName ?? "server");
    return this.getDiscoveredTools(serverId).map((row) => {
      const catalogEntry = catalog.find(
        (tool) => tool.serverId === serverId && tool.toolName === row.toolName,
      );
      return {
        ...row,
        exposedName: catalogEntry?.exposedName ?? `${slug}__${row.toolName}`,
        disabled: disabledForServer.has(row.toolName),
      };
    });
  }
}

export const toolCatalogService = new ToolCatalogService();
