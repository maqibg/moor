import { run, queryAll, queryOne, transaction } from "../db/index.js";
import { serializeProfile, serializeProfileServer, serializeServer } from "../db/serializers.js";
import { eventBus } from "./event-bus.js";

class ProfileService {
  list() {
    const rows = queryAll(
      `SELECT p.*, COUNT(ps.server_id) as server_count
       FROM profiles p
       LEFT JOIN profile_servers ps ON p.id = ps.profile_id
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [],
    );
    return rows.map((r) => serializeProfile(r));
  }

  create(name: string) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    run(
      "INSERT INTO profiles (id, name, is_active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
      [id, name, now, now],
    );
    const row = queryOne("SELECT * FROM profiles WHERE id = ?", [id]);
    return serializeProfile(row ?? {});
  }

  getById(id: string) {
    const profile = queryOne(
      `SELECT p.*, COUNT(ps.server_id) as server_count
       FROM profiles p
       LEFT JOIN profile_servers ps ON p.id = ps.profile_id
       WHERE p.id = ?
       GROUP BY p.id`,
      [id],
    );
    if (!profile) return null;

    const servers = queryAll(
      `SELECT ms.*, ps.profile_id, ps.enabled, ps.disabled_tools
       FROM mcp_servers ms
       LEFT JOIN profile_servers ps ON ps.server_id = ms.id AND ps.profile_id = ?
       ORDER BY ms.name ASC`,
      [id],
    ).map((row) => ({
      ...serializeServer(row),
      profileServer: serializeProfileServer({
        profile_id: id,
        server_id: row.id,
        enabled: row.enabled ?? 0,
        disabled_tools: row.disabled_tools ?? "[]",
      }),
    }));

    return { ...serializeProfile(profile), servers };
  }

  update(id: string, data: { name?: string }) {
    const existing = queryOne("SELECT id FROM profiles WHERE id = ?", [id]);
    if (!existing) return null;
    if (data.name) {
      run("UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?", [
        data.name,
        new Date().toISOString(),
        id,
      ]);
    }
    const row = queryOne("SELECT * FROM profiles WHERE id = ?", [id]);
    return serializeProfile(row ?? {});
  }

  activate(id: string) {
    const existing = queryOne("SELECT id FROM profiles WHERE id = ?", [id]);
    if (!existing) return null;
    transaction(() => {
      run("UPDATE profiles SET is_active = 0");
      run("UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?", [
        new Date().toISOString(),
        id,
      ]);
    });
    eventBus.emit("profile:activated", { type: "profile:activated", data: { profileId: id } });
    const row = queryOne("SELECT * FROM profiles WHERE id = ?", [id]);
    return serializeProfile(row ?? {});
  }

  remove(id: string) {
    const existing = queryOne("SELECT id, is_active FROM profiles WHERE id = ?", [id]);
    if (!existing) return { error: "not found" };
    if (existing.is_active) return { error: "active" };
    run("DELETE FROM profiles WHERE id = ?", [id]);
    return null;
  }

  getActiveProfileId(): string | null {
    const row = queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
    return (row?.id as string) ?? null;
  }

  getActiveProfileServers() {
    const activeProfileId = this.getActiveProfileId();
    if (!activeProfileId) return [];
    return queryAll(
      "SELECT ps.*, ms.name, ms.connection_type FROM profile_servers ps JOIN mcp_servers ms ON ps.server_id = ms.id WHERE ps.profile_id = ? AND ps.enabled = 1",
      [activeProfileId],
    );
  }

  updateProfileServer(
    profileId: string,
    serverId: string,
    data: { enabled?: boolean; disabledTools?: string[] },
  ) {
    const existing = queryOne(
      "SELECT * FROM profile_servers WHERE profile_id = ? AND server_id = ?",
      [profileId, serverId],
    );
    const enabled =
      data.enabled !== undefined
        ? data.enabled
          ? 1
          : 0
        : existing
          ? (existing.enabled as number)
          : 1;
    const disabledTools =
      data.disabledTools !== undefined
        ? JSON.stringify(data.disabledTools)
        : existing
          ? (existing.disabled_tools as string)
          : "[]";

    if (existing) {
      run(
        "UPDATE profile_servers SET enabled = ?, disabled_tools = ? WHERE profile_id = ? AND server_id = ?",
        [enabled, disabledTools, profileId, serverId],
      );
    } else {
      run(
        "INSERT INTO profile_servers (profile_id, server_id, enabled, disabled_tools) VALUES (?, ?, ?, ?)",
        [profileId, serverId, enabled, disabledTools],
      );
    }
    const row = queryOne("SELECT * FROM profile_servers WHERE profile_id = ? AND server_id = ?", [
      profileId,
      serverId,
    ]);
    return serializeProfileServer(row ?? {});
  }

  assignToActiveProfile(serverIds: string[]) {
    const activeProfile = queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
    if (!activeProfile) return;
    for (const serverId of serverIds) {
      run(
        "INSERT OR IGNORE INTO profile_servers (profile_id, server_id, enabled, disabled_tools) VALUES (?, ?, 1, '[]')",
        [activeProfile.id, serverId],
      );
    }
  }

  seedDefault() {
    const rows = queryAll("SELECT id FROM profiles WHERE name = 'Default'", []);
    const now = new Date().toISOString();
    run("UPDATE profiles SET is_active = 0", []);
    if (rows.length === 0) {
      run(
        "INSERT INTO profiles (id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
        [crypto.randomUUID(), "Default", now, now],
      );
    } else {
      run("UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?", [now, rows[0].id]);
    }
  }
}

export const profileService = new ProfileService();
