import { getProfileRepository, type ProfileServerRow } from "../db/profile-repository.js";
import { eventBus } from "./event-bus.js";
import type { Profile } from "@moor/types";

class ProfileService {
  list(): Profile[] {
    return getProfileRepository().findAll();
  }

  create(name: string): Profile {
    return getProfileRepository().create(name);
  }

  getById(id: string) {
    const profileRepo = getProfileRepository();
    const profile = profileRepo.findById(id);
    if (!profile) return null;

    const servers = profileRepo.findProfileServers(id);

    return { ...profile, servers };
  }

  update(id: string, data: { name?: string }): Profile | null {
    return getProfileRepository().update(id, data);
  }

  activate(id: string): Profile | null {
    const result = getProfileRepository().activate(id);
    if (result) {
      eventBus.emit("profile:activated", { type: "profile:activated", data: { profileId: id } });
    }
    return result;
  }

  remove(id: string): { success: true } | { error: "not_found" | "active" } {
    return getProfileRepository().remove(id);
  }

  getActiveProfileId(): string | null {
    return getProfileRepository().findActiveId();
  }

  getActiveProfileServers() {
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
