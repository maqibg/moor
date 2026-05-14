import { getServerRepository, ServerRepository } from "../db/server-repository.js";
import { getDatabase } from "../db/index.js";
import { profileService } from "./profiles.js";
import type { Server } from "@moor/types";

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

export class ServerStore {
  add(config: ServerConfig): Server {
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
    return repo.findById(id)!;
  }

  update(id: string, fields: Record<string, unknown>): Server | null {
    const existing = getServerRepository().findById(id);
    if (!existing) return null;
    getServerRepository().update(id, fields);
    return getServerRepository().findById(id);
  }

  remove(id: string): boolean {
    const existing = getServerRepository().findById(id);
    if (!existing) return false;
    getServerRepository().remove(id);
    return true;
  }

  reorder(ids: string[]): Server[] | null {
    if (new Set(ids).size !== ids.length) return null;
    const repo = getServerRepository();
    const existingIds = repo.findIds();
    const existing = new Set(existingIds);
    if (ids.length !== existingIds.length || ids.some((id) => !existing.has(id))) return null;
    repo.reorder(ids);
    return repo.findAll();
  }

  findById(id: string): Server | null {
    return getServerRepository().findById(id);
  }

  findAll(): Server[] {
    return getServerRepository().findAll();
  }

  loadAll(): Server[] {
    return getServerRepository().loadAll();
  }

  resetRunningStatuses(): void {
    const db = getDatabase();
    db.transaction(() => {
      new ServerRepository(db).resetRunningStatuses();
    });
  }

  getActiveProfileId(): string | null {
    return profileService.getActiveProfileId();
  }

  getActiveProfileServerIds(): string[] {
    const activeServers = profileService.getActiveProfileServers();
    return activeServers.map((s) => s.serverId);
  }
}

export const serverStore = new ServerStore();
