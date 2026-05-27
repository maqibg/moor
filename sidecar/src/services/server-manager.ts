import { serverService } from "./server-service.js";
import { ServerLifecycle } from "./server-lifecycle.js";
import { getPublicServerStartErrorMessage } from "./server-start-error.js";
import type { ServerSession, SessionFactory } from "./session-manager.js";
import type { Server, ServerUpdateInput, ToolCatalogEntry } from "@moor/types";

export type { ServerSession, SessionFactory };
export { getPublicServerStartErrorMessage };

export interface ServerConfig {
  name: string;
  connectionType: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  workingDir?: string;
  autoStart?: boolean;
}

export interface ManagedServer {
  id: string;
  name: string;
  connectionType: "stdio" | "http";
  status: "stopped" | "starting" | "running" | "error";
  autoStart: boolean;
}

export class ServerRuntime {
  private lifecycle: ServerLifecycle;

  constructor(sessionFactory?: SessionFactory) {
    this.lifecycle = new ServerLifecycle(serverService, sessionFactory);
  }

  addServer(config: ServerConfig): Server {
    return serverService.addServer(config);
  }

  loadFromDb(): void {
    serverService.loadFromDb();
  }

  resetForTest(): void {
    serverService.resetForTest();
    this.lifecycle.resetForTest();
  }

  getServer(id: string): ManagedServer | undefined {
    return serverService.getServer(id);
  }

  getActiveProfileId(): string | null {
    return this.lifecycle.getActiveProfileId();
  }

  registerServer(id: string): void {
    serverService.registerServer(id);
  }

  unregisterServer(id: string): void {
    serverService.unregisterServer(id);
  }

  listServers(): Server[] {
    return serverService.listServers();
  }

  getServerDetail(id: string): (Server & { runtime?: ManagedServer }) | null {
    return serverService.getServerDetail(id);
  }

  updateServer(id: string, body: ServerUpdateInput): Server | null {
    return serverService.updateServer(id, body);
  }

  async removeServer(id: string): Promise<boolean> {
    const runtime = this.getServer(id);
    if (runtime?.status === "running") {
      try {
        await this.lifecycle.stopServer(id);
      } catch (err) {
        console.warn(`Failed to stop server ${id} before removal; removing it anyway.`, err);
      }
    }
    return serverService.removeServer(id);
  }

  async startServer(id: string): Promise<void> {
    return this.lifecycle.startServer(id);
  }

  async stopServer(id: string): Promise<void> {
    return this.lifecycle.stopServer(id);
  }

  async stopAll(): Promise<void> {
    return this.lifecycle.stopAll();
  }

  autoStartEligibleServers(): ManagedServer[] {
    return this.lifecycle.autoStartEligibleServers();
  }

  async startAutoStartServers(): Promise<void> {
    return this.lifecycle.startAutoStartServers();
  }

  async callToolByExposedName(exposedName: string, args: unknown): Promise<unknown> {
    return this.lifecycle.callToolByExposedName(exposedName, args);
  }

  findToolOwner(exposedName: string): ToolCatalogEntry | null {
    return this.lifecycle.findToolOwner(exposedName);
  }

  getToolCatalog(profileId?: string | null): ToolCatalogEntry[] {
    return this.lifecycle.getToolCatalog(profileId);
  }

  cacheTools(
    serverId: string,
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  ): void {
    this.lifecycle.cacheTools(serverId, tools);
  }

  getDiscoveredTools(serverId: string) {
    return this.lifecycle.getDiscoveredTools(serverId);
  }

  getToolDetails(serverId: string, profileId?: string) {
    return this.lifecycle.getToolDetails(serverId, profileId);
  }

  getActiveProfileServers(): Array<{ serverId: string; server: ManagedServer }> {
    return this.lifecycle.getActiveProfileServers();
  }

  reorderServers(serverIds: string[]): Server[] {
    return serverService.reorderServers(serverIds);
  }
}

export const serverManager = new ServerRuntime();
