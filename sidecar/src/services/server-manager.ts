import { getServerRepository } from "../db/server-repository.js";
import { getToolDiscoveryRepository } from "../db/tool-discovery-repository.js";
import { toolCatalogService } from "./tool-catalog-service.js";
import { serverStore } from "./server-store.js";
import { SessionManager } from "./session-manager.js";
import type { StoredServerConfig, ServerSession, SessionFactory } from "./session-manager.js";
import type { ToolCatalogEntry } from "@moor/types";
import { eventBus } from "./event-bus.js";

export type { StoredServerConfig, ServerSession, SessionFactory };

export interface ManagedServer {
  id: string;
  name: string;
  connectionType: "stdio" | "http";
  status: "stopped" | "starting" | "running" | "error";
  autoStart: boolean;
}

export function getPublicServerStartErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const missingCommand =
    /^Command "([^"]+)" was not found on PATH while starting this stdio server\./.exec(message);
  if (missingCommand) {
    return `Command "${missingCommand[1]}" was not found. Configure an absolute command path or update this server environment.`;
  }

  const missingAbsoluteCommand =
    /^Command "([^"]+)" is not executable while starting this stdio server\./.exec(message);
  if (missingAbsoluteCommand) {
    return `Command "${missingAbsoluteCommand[1]}" is not executable. Check that the absolute path exists and has execute permission.`;
  }

  return "Server failed to start. Check logs for details.";
}

export class ServerRuntime {
  private servers: Map<string, ManagedServer> = new Map();
  private sessionManager: SessionManager;

  constructor(sessionFactory?: SessionFactory) {
    this.sessionManager = new SessionManager(sessionFactory);
  }

  loadFromDb() {
    this.servers.clear();
    serverStore.resetRunningStatuses();
    const rows = serverStore.loadAll();
    for (const row of rows) {
      this.servers.set(row.id, {
        id: row.id,
        name: row.name,
        connectionType: row.connectionType,
        status: row.status,
        autoStart: row.autoStart,
      });
    }
  }

  resetForTest() {
    this.servers.clear();
    this.sessionManager.resetForTest();
  }

  getServer(id: string): ManagedServer | undefined {
    return this.servers.get(id);
  }

  getActiveProfileId(): string | null {
    return serverStore.getActiveProfileId();
  }

  listServers(): ManagedServer[] {
    return Array.from(this.servers.values());
  }

  registerServer(id: string): void {
    const row = serverStore.findById(id);
    if (!row) return;
    this.servers.set(id, {
      id: row.id,
      name: row.name,
      connectionType: row.connectionType,
      status: row.status,
      autoStart: row.autoStart,
    });
  }

  unregisterServer(id: string): void {
    this.servers.delete(id);
  }

  async startServer(id: string): Promise<void> {
    const server = this.servers.get(id);
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
      const config = this.getStoredServerConfig(id);
      const session = await this.sessionManager.createSession(id, config);

      const toolsResult = await session.client.listTools();
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
      console.error(`Failed to start server ${id}:`, err);
      this.setServerStatus(id, "error", getPublicServerStartErrorMessage(err));
      throw err;
    }
  }

  async stopServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server || server.status !== "running") return;
    await this.sessionManager.destroySession(id);
    this.setServerStatus(id, "stopped");
  }

  async stopAll() {
    await Promise.all(Array.from(this.servers.keys()).map((id) => this.stopServer(id)));
  }

  autoStartEligibleServers(): ManagedServer[] {
    return this.getActiveProfileServers()
      .filter((ps) => ps.server.autoStart)
      .map((ps) => ps.server);
  }

  async startAutoStartServers(): Promise<void> {
    const servers = this.autoStartEligibleServers();
    await Promise.allSettled(servers.map((server) => this.startServer(server.id)));
  }

  async callToolByExposedName(exposedName: string, args: unknown): Promise<unknown> {
    const owner = this.findToolOwner(exposedName);
    if (!owner) throw new Error(`Tool "${exposedName}" not found or disabled`);

    const session = this.sessionManager.getSession(owner.serverId);
    if (!session) throw new Error(`Server "${owner.serverName}" is not running`);
    return session.client.callTool({
      name: owner.toolName,
      arguments: args as Record<string, unknown>,
    });
  }

  findToolOwner(exposedName: string): ToolCatalogEntry | null {
    return this.getToolCatalog().find((tool) => tool.exposedName === exposedName) ?? null;
  }

  getToolCatalog(profileId?: string | null): ToolCatalogEntry[] {
    return toolCatalogService.getToolCatalog(profileId, {
      serverIds: this.getCallableServerIds(),
    });
  }

  private getCallableServerIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const server of this.servers.values()) {
      if (server.status === "running" && this.sessionManager.getSession(server.id)) {
        ids.add(server.id);
      }
    }
    return ids;
  }

  getActiveProfileServers() {
    const activeIds = serverStore.getActiveProfileServerIds();
    return activeIds
      .map((serverId) => {
        const server = this.servers.get(serverId);
        if (!server) return null;
        return { serverId, server };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  cacheTools(
    serverId: string,
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  ) {
    getToolDiscoveryRepository().replaceToolsForServer(serverId, tools);
    eventBus.emit("server:tools", { type: "server:tools", data: { serverId, tools } });
  }

  getDiscoveredTools(serverId: string) {
    return toolCatalogService.getDiscoveredTools(serverId);
  }

  getToolDetails(serverId: string, profileId?: string) {
    return toolCatalogService.getToolDetails(serverId, profileId, {
      serverIds: this.getCallableServerIds(),
    });
  }

  private setServerStatus(id: string, status: ManagedServer["status"], errorMessage?: string) {
    const server = this.servers.get(id);
    if (!server) return;
    server.status = status;
    getServerRepository().updateStatus(id, status, errorMessage ?? null);
    eventBus.emit("server:status", {
      type: "server:status",
      data: { serverId: id, status, errorMessage },
    });
  }

  private getStoredServerConfig(id: string): StoredServerConfig {
    const row = serverStore.findById(id);
    if (!row) throw new Error(`Server ${id} not found`);
    return {
      id: row.id,
      name: row.name,
      connection_type: row.connectionType,
      command: row.command ?? null,
      args: row.args ?? null,
      url: row.url ?? null,
      env: row.env ?? null,
      headers: row.headers ?? null,
      working_dir: row.workingDir ?? null,
      auto_start: row.autoStart,
    };
  }
}

export const serverManager = new ServerRuntime();
