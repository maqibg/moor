import { getServerRepository, ServerRepository } from "../db/server-repository.js";
import { getToolDiscoveryRepository } from "../db/tool-discovery-repository.js";
import { getProfileRepository } from "../db/profile-repository.js";
import { getDatabase } from "../db/index.js";
import { toolCatalogService } from "./tool-catalog-service.js";
import { profileService } from "./profiles.js";
import { SessionManager } from "./session-manager.js";
import type { StoredServerConfig, ServerSession, SessionFactory } from "./session-manager.js";
import type { Server, ToolCatalogEntry } from "@moor/types";
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

export class ServerManager {
  private servers: Map<string, ManagedServer> = new Map();
  private sessionManager: SessionManager;

  constructor(sessionFactory?: SessionFactory) {
    this.sessionManager = new SessionManager(sessionFactory);
  }

  loadFromDb() {
    this.servers.clear();
    const db = getDatabase();
    db.transaction(() => {
      const serverRepo = new ServerRepository(db);
      serverRepo.resetRunningStatuses();
      const rows = serverRepo.loadAll();
      for (const row of rows) {
        this.servers.set(row.id, {
          id: row.id,
          name: row.name,
          connectionType: row.connectionType,
          status: row.status,
          autoStart: row.autoStart,
        });
      }
    });
  }

  resetForTest() {
    this.servers.clear();
    this.sessionManager.resetForTest();
  }

  getServer(id: string): ManagedServer | undefined {
    return this.servers.get(id);
  }

  getActiveProfileId(): string | null {
    return profileService.getActiveProfileId();
  }

  listServers(): ManagedServer[] {
    return Array.from(this.servers.values());
  }

  addServer(config: {
    name: string;
    connectionType: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    workingDir?: string;
    autoStart?: boolean;
  }): ManagedServer {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const serverRepo = getServerRepository();
    serverRepo.insert({
      id,
      name: config.name,
      connectionType: config.connectionType,
      command: config.command ?? null,
      args: config.args ? JSON.stringify(config.args) : null,
      url: config.url ?? null,
      env: config.env ? JSON.stringify(config.env) : null,
      headers: config.headers ? JSON.stringify(config.headers) : null,
      workingDir: config.workingDir ?? null,
      autoStart: config.autoStart ? 1 : 0,
      sortOrder: serverRepo.nextTopSortOrder(),
      createdAt: now,
      updatedAt: now,
    });

    const server: ManagedServer = {
      id,
      name: config.name,
      connectionType: config.connectionType,
      status: "stopped",
      autoStart: config.autoStart ?? false,
    };
    this.servers.set(id, server);
    return server;
  }

  updateServer(id: string, updates: Record<string, unknown>): ManagedServer | null {
    const server = this.servers.get(id);
    if (!server) return null;

    const allowedFields: Record<string, string> = {
      name: "name",
      command: "command",
      args: "args",
      url: "url",
      env: "env",
      headers: "headers",
      workingDir: "working_dir",
      working_dir: "working_dir",
      autoStart: "auto_start",
    };
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [field, col] of Object.entries(allowedFields)) {
      if (field in updates) {
        setClauses.push(`${col} = ?`);
        const val = updates[field];
        if (field === "autoStart") {
          values.push(val ? 1 : 0);
        } else if (typeof val === "object" && val !== null) {
          values.push(JSON.stringify(val));
        } else {
          values.push(val);
        }
      }
    }

    if (setClauses.length === 0) return server;
    setClauses.push("updated_at = ?");
    values.push(new Date().toISOString());

    getServerRepository().update(id, setClauses, values);
    if (updates.name) server.name = updates.name as string;
    if ("autoStart" in updates) server.autoStart = Boolean(updates.autoStart);
    return server;
  }

  async removeServer(id: string): Promise<boolean> {
    const server = this.servers.get(id);
    if (!server) return false;
    if (server.status === "running") await this.stopServer(id);
    getServerRepository().remove(id);
    this.servers.delete(id);
    return true;
  }

  reorderServers(ids: string[]): Server[] | null {
    if (new Set(ids).size !== ids.length) return null;
    const serverRepo = getServerRepository();
    const existingIds = serverRepo.findIds();
    const existing = new Set(existingIds);
    if (ids.length !== existingIds.length || ids.some((id) => !existing.has(id))) return null;

    serverRepo.reorder(ids);
    return serverRepo.findAll();
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
    return toolCatalogService.findToolOwner(exposedName);
  }

  getToolCatalog(profileId?: string | null): ToolCatalogEntry[] {
    return toolCatalogService.getToolCatalog(profileId);
  }

  getActiveProfileServers() {
    const activeProfileId = profileService.getActiveProfileId();
    if (!activeProfileId) return [];
    const serverIds = getProfileRepository().findActiveProfileServerIds();
    return serverIds
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
    return toolCatalogService.getToolDetails(serverId, profileId);
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
    const row = getServerRepository().findById(id);
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

export const serverManager = new ServerManager();
