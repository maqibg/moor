import { getProfileRepository, type ProfileServerRow } from "../db/profile-repository.js";
import { eventBus } from "./event-bus.js";
import type { Profile, ProfileDetail } from "@moor/types";

export interface ActiveProfileServer {
  serverId: string;
  connectionType: "stdio" | "http";
  name: string;
}

class ProfileService {
  list(): Profile[] {
    return getProfileRepository().findAll();
  }

  create(name: string): Profile {
    return getProfileRepository().create(name);
  }

  getById(id: string): ProfileDetail | null {
    const repo = getProfileRepository();
    const profile = repo.findById(id);
    if (!profile) return null;
    const servers = repo.findProfileServers(id);
    return { ...profile, servers };
  }

  update(id: string, name?: string): Profile | null {
    return getProfileRepository().update(id, { name });
  }

  remove(id: string): { success: true } | { error: "not_found" | "active" } {
    return getProfileRepository().remove(id);
  }

  activate(id: string): Profile | null {
    const result = getProfileRepository().activate(id);
    if (result) {
      eventBus.emit("profile:activated", { profileId: id });
    }
    return result;
  }

  getActiveProfileId(): string | null {
    return getProfileRepository().findActiveId();
  }

  getActiveProfileServers(): ActiveProfileServer[] {
    const repo = getProfileRepository();
    const activeProfileId = repo.findActiveId();
    if (!activeProfileId) return [];
    return repo
      .findProfileServers(activeProfileId)
      .filter((row) => row.profileServer.enabled)
      .map((row) => ({
        serverId: row.id,
        connectionType: row.connectionType,
        name: row.name,
      }));
  }

  updateProfileServer(
    profileId: string,
    serverId: string,
    data: { enabled?: boolean; disabledTools?: string[] },
  ): ProfileServerRow {
    return getProfileRepository().upsertProfileServer(profileId, serverId, data);
  }

  assignToActiveProfile(serverIds: string[]): void {
    getProfileRepository().assignToActiveProfile(serverIds);
  }

  seedDefault() {
    getProfileRepository().seedDefault();
  }
}

export const profileService = new ProfileService();
