import { getServerRepository } from "../db/server-repository.js";
import { profileService } from "./profiles.js";
import { getDatabase } from "../db/index.js";
import type { Server, ServerUpdateInput } from "@moor/types";
import type { ManagedServer, ServerConfig } from "./server-manager.js";

export class ServerOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerOrderError";
  }
}

export class ServerService {
  private servers: Map<string, ManagedServer> = new Map();

  registerServer(id: string): void {
    const row = getServerRepository().findById(id);
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

  getServer(id: string): ManagedServer | undefined {
    return this.servers.get(id);
  }

  listServers(): Server[] {
    return getServerRepository().findAll();
  }

  getServerDetail(id: string): (Server & { runtime?: ManagedServer }) | null {
    const row = getServerRepository().findById(id);
    if (!row) return null;
    const runtime = this.getServer(id);
    return runtime ? { ...row, runtime } : row;
  }

  addServer(config: ServerConfig): Server {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const repo = getServerRepository();
    repo.insert({
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
      sortOrder: repo.nextTopSortOrder(),
      createdAt: now,
      updatedAt: now,
    });
    this.registerServer(id);
    profileService.assignToActiveProfile([id]);
    return repo.findById(id)!;
  }

  updateServer(id: string, body: ServerUpdateInput): Server | null {
    const repo = getServerRepository();
    const server = repo.findById(id);
    if (!server) return null;
    repo.update(id, body);
    const updated = repo.findById(id)!;
    const runtime = this.getServer(id);
    if (runtime) {
      if (body.name) runtime.name = updated.name;
      if ("autoStart" in body) runtime.autoStart = updated.autoStart;
    }
    return updated;
  }

  removeServer(id: string): boolean {
    const existing = getServerRepository().findById(id);
    if (!existing) return false;
    getServerRepository().remove(id);
    this.unregisterServer(id);
    return true;
  }

  reorderServers(serverIds: string[]): Server[] {
    const repo = getServerRepository();
    const existingIds = repo.findIds();
    const existing = new Set(existingIds);
    if (
      new Set(serverIds).size !== serverIds.length ||
      serverIds.length !== existingIds.length ||
      serverIds.some((id) => !existing.has(id))
    ) {
      throw new ServerOrderError("Server order must include every existing server exactly once.");
    }
    repo.reorder(serverIds);
    return repo.findAll();
  }

  loadFromDb(): void {
    this.servers.clear();
    const db = getDatabase();
    db.transaction(() => {
      db.run(
        "UPDATE mcp_servers SET status = 'stopped', error_message = NULL WHERE status IN ('running', 'starting')",
      );
    });
    const rows = getServerRepository().findAll();
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

  resetForTest(): void {
    this.servers.clear();
  }

  getAllServers(): IterableIterator<ManagedServer> {
    return this.servers.values();
  }

  getAllServerIds(): string[] {
    return Array.from(this.servers.keys());
  }
}

export const serverService = new ServerService();
