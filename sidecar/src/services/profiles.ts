import { getProfileRepository, type ProfileServerRow } from "../db/profile-repository.js";
import { eventBus } from "./event-bus.js";
import type { Profile } from "@moor/types";

export interface ActiveProfileServer {
  serverId: string;
  connectionType: "stdio" | "http";
  name: string;
}

class ProfileService {
  activate(id: string): Profile | null {
    const result = getProfileRepository().activate(id);
    if (result) {
      eventBus.emit("profile:activated", { type: "profile:activated", data: { profileId: id } });
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
