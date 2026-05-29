import { getServerRepository } from "../db/server-repository.js";
import { getToolDiscoveryRepository } from "../db/tool-discovery-repository.js";
import { toolCatalogService } from "./tool-catalog-service.js";
import { getRemainingStartTimeoutMs, SessionManager } from "./session-manager.js";
import { getPublicServerStartErrorMessage } from "./server-start-error.js";
import type { SessionFactory } from "./session-manager.js";
import type { ToolCatalogEntry } from "@moor/types";
import type { ManagedServer } from "./server-manager.js";
import type { ServerService } from "./server-service.js";
import { eventBus } from "./event-bus.js";
import { profileService } from "./profiles.js";
import { settingsService } from "./settings.js";

interface McpTimeoutSettings {
  requestTimeoutMs: number;
  startTimeoutMs: number;
}

export class ServerLifecycle {
  private sessionManager: SessionManager;
  private service: ServerService;

  constructor(service: ServerService, sessionFactory?: SessionFactory) {
    this.service = service;
    this.sessionManager = new SessionManager(sessionFactory);
  }

  async startServer(id: string): Promise<void> {
    const server = this.service.getServer(id);
    if (!server) throw new Error(`Server ${id} not found`);
    if (server.status === "running") return;
    const existingStart = this.sessionManager.getStartPromise(id);
    if (existingStart) return existingStart;

    const startPromise = this.startServerSession(id);
    this.sessionManager.setStartPromise(id, startPromise);
    try {
      await startPromise;
    } finally {
      this.sessionManager.deleteStartPromise(id);
    }
  }

  private async startServerSession(id: string): Promise<void> {
    this.setServerStatus(id, "starting");
    try {
      const server = getServerRepository().findById(id);
      if (!server) throw new Error(`Server ${id} not found`);
      const timeouts = this.getMcpTimeoutSettings();
      const startTimeouts = {
        ...timeouts,
        startDeadlineMs: Date.now() + timeouts.startTimeoutMs,
      };
      const session = await this.sessionManager.createSession(id, server, startTimeouts);
      if (this.service.getServer(id)?.status !== "starting") {
        await this.sessionManager.destroySession(id).catch(() => {});
        return;
      }

      const toolsResult = await session.client.listTools(undefined, {
        timeout: getRemainingStartTimeoutMs(startTimeouts),
      });
      if (this.service.getServer(id)?.status !== "starting") {
        await this.sessionManager.destroySession(id).catch(() => {});
        return;
      }
      this.cacheTools(
        id,
        toolsResult.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      );

      this.setServerStatus(id, "running");
    } catch (err) {
      await this.sessionManager.destroySession(id).catch(() => {});
      if (this.service.getServer(id)?.status !== "starting") {
        return;
      }
      console.error(`Failed to start server ${id}:`, err);
      this.setServerStatus(id, "error", getPublicServerStartErrorMessage(err));
      throw err;
    }
  }

  async stopServer(id: string): Promise<void> {
    const server = this.service.getServer(id);
    if (!server && !this.sessionManager.getSession(id)) return;
    await this.sessionManager.destroySession(id);
    if (server) {
      this.setServerStatus(id, "stopped");
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.service.getAllServerIds().map((id) => this.stopServer(id)));
  }

  async startAutoStartServers(): Promise<void> {
    const servers = this.autoStartEligibleServers();
    await Promise.allSettled(servers.map((server) => this.startServer(server.id)));
  }

  autoStartEligibleServers(): ManagedServer[] {
    return this.getActiveProfileServers()
      .filter((ps) => ps.server.autoStart)
      .map((ps) => ps.server);
  }

  getActiveProfileServers(): Array<{ serverId: string; server: ManagedServer }> {
    const activeIds = profileService.getActiveProfileServers().map((server) => server.serverId);
    return activeIds
      .map((serverId) => {
        const server = this.service.getServer(serverId);
        if (!server) return null;
        return { serverId, server };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  getActiveProfileId(): string | null {
    return profileService.getActiveProfileId();
  }

  async callToolByExposedName(exposedName: string, args: unknown): Promise<unknown> {
    const owner = this.findToolOwner(exposedName);
    if (!owner) throw new Error(`Tool "${exposedName}" not found or disabled`);

    const session = this.sessionManager.getSession(owner.serverId);
    if (!session) throw new Error(`Server "${owner.serverName}" is not running`);
    const { requestTimeoutMs } = this.getMcpTimeoutSettings();
    return session.client.callTool(
      {
        name: owner.toolName,
        arguments: args as Record<string, unknown>,
      },
      undefined,
      { timeout: requestTimeoutMs },
    );
  }

  findToolOwner(exposedName: string): ToolCatalogEntry | null {
    return this.getToolCatalog().find((tool) => tool.exposedName === exposedName) ?? null;
  }

  getToolCatalog(profileId?: string | null): ToolCatalogEntry[] {
    return toolCatalogService.getToolCatalog(profileId, {
      serverIds: this.getCallableServerIds(),
    });
  }

  cacheTools(
    serverId: string,
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  ): void {
    getToolDiscoveryRepository().replaceToolsForServer(serverId, tools);
    eventBus.emit("server:tools", { serverId });
  }

  getDiscoveredTools(serverId: string) {
    return toolCatalogService.getDiscoveredTools(serverId);
  }

  getToolDetails(serverId: string, profileId?: string) {
    return toolCatalogService.getToolDetails(serverId, profileId, {
      serverIds: this.getCallableServerIds(),
    });
  }

  resetForTest(): void {
    this.sessionManager.resetForTest();
  }

  private getCallableServerIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const server of this.service.getAllServers()) {
      if (server.status === "running" && this.sessionManager.getSession(server.id)) {
        ids.add(server.id);
      }
    }
    return ids;
  }

  private getMcpTimeoutSettings(): McpTimeoutSettings {
    const advanced = settingsService.getSettings().advanced;
    return {
      requestTimeoutMs: advanced.mcpRequestTimeoutMs,
      startTimeoutMs: advanced.mcpServerStartTimeoutMs,
    };
  }

  private setServerStatus(
    id: string,
    status: ManagedServer["status"],
    errorMessage?: string,
  ): void {
    const server = this.service.getServer(id);
    if (!server) return;
    server.status = status;
    getServerRepository().updateStatus(id, status, errorMessage ?? null);
    eventBus.emit("server:status", {
      serverId: id,
      status,
      errorMessage,
    });
  }
}
