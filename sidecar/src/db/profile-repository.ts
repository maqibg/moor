import type { Database } from "./index.js";
import { getDatabase } from "./index.js";
import type { Profile, ProfileDetail, ProfileServerState } from "@moor/types";
import { parseJsonValue, keysToCamelCase, serializeServer } from "./serializers.js";

type ProfileDetailServer = ProfileDetail["servers"][number];

function serializeProfile(row: Record<string, unknown>): Profile {
  return keysToCamelCase({
    ...row,
    is_active: Boolean(row.is_active),
    server_count: Number(row.server_count ?? 0),
  }) as unknown as Profile;
}

export interface ProfileServerRow {
  serverId: string;
  enabled: boolean;
  disabledTools: string[];
}

function parseDisabledTools(value: unknown): string[] {
  return parseJsonValue(value, []) as string[];
}

function requireRow(row: Record<string, unknown> | null, message: string): Record<string, unknown> {
  if (!row) throw new Error(message);
  return row;
}

function serializeProfileServerState(row: Record<string, unknown>): ProfileServerRow {
  const camel = keysToCamelCase({
    ...row,
    enabled: Boolean(row.enabled),
    disabled_tools: parseDisabledTools(row.disabled_tools),
  });
  return {
    serverId: String(camel.serverId),
    enabled: Boolean(camel.enabled),
    disabledTools: (camel.disabledTools ?? []) as string[],
  };
}

function serializeProfileDetailServer(row: Record<string, unknown>): ProfileDetailServer {
  const { profile_enabled, profile_disabled_tools, ...serverRow } = row;
  const server = serializeServer(serverRow) as unknown as Omit<
    ProfileDetailServer,
    "profileServer"
  >;

  return {
    ...server,
    profileServer: {
      enabled: profile_enabled == null ? false : Boolean(profile_enabled),
      disabledTools: parseDisabledTools(profile_disabled_tools),
    } satisfies ProfileServerState,
  };
}

export class ProfileRepository {
  constructor(private db: Database) {}

  findAll(): Profile[] {
    const rows = this.db.queryAll(
      `SELECT p.*, COUNT(ps.server_id) as server_count
       FROM profiles p
       LEFT JOIN profile_servers ps ON p.id = ps.profile_id
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [],
    );
    return rows.map(serializeProfile);
  }

  findById(id: string): Profile | null {
    const row = this.db.queryOne(
      `SELECT p.*, COUNT(ps.server_id) as server_count
       FROM profiles p
       LEFT JOIN profile_servers ps ON p.id = ps.profile_id
       WHERE p.id = ?
       GROUP BY p.id`,
      [id],
    );
    return row ? serializeProfile(row) : null;
  }

  findActiveId(): string | null {
    const row = this.db.queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
    return (row?.id as string) ?? null;
  }

  create(name: string): Profile {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      "INSERT INTO profiles (id, name, is_active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
      [id, name, now, now],
    );
    const row = this.db.queryOne("SELECT * FROM profiles WHERE id = ?", [id]);
    return serializeProfile(requireRow(row, "Created profile could not be reloaded"));
  }

  update(id: string, data: { name?: string }): Profile | null {
    const existing = this.db.queryOne("SELECT id FROM profiles WHERE id = ?", [id]);
    if (!existing) return null;
    if (data.name) {
      this.db.run("UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?", [
        data.name,
        new Date().toISOString(),
        id,
      ]);
    }
    const row = this.db.queryOne("SELECT * FROM profiles WHERE id = ?", [id]);
    return serializeProfile(requireRow(row, "Updated profile could not be reloaded"));
  }

  activate(id: string): Profile | null {
    const existing = this.db.queryOne("SELECT id FROM profiles WHERE id = ?", [id]);
    if (!existing) return null;
    this.db.transaction(() => {
      this.db.run("UPDATE profiles SET is_active = 0 WHERE id != ?", [id]);
      this.db.run("UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?", [
        new Date().toISOString(),
        id,
      ]);
    });
    const row = this.db.queryOne("SELECT * FROM profiles WHERE id = ?", [id]);
    return serializeProfile(requireRow(row, "Activated profile could not be reloaded"));
  }

  remove(id: string): { success: true } | { error: "not_found" | "active" } {
    const existing = this.db.queryOne("SELECT id, is_active FROM profiles WHERE id = ?", [id]);
    if (!existing) return { error: "not_found" };
    if (existing.is_active) return { error: "active" };
    this.db.run("DELETE FROM profiles WHERE id = ?", [id]);
    return { success: true };
  }

  findProfileServers(profileId: string): ProfileDetailServer[] {
    const rows = this.db.queryAll(
      `SELECT ms.*, ps.enabled AS profile_enabled, ps.disabled_tools AS profile_disabled_tools
       FROM mcp_servers ms
       LEFT JOIN profile_servers ps ON ps.server_id = ms.id AND ps.profile_id = ?
       ORDER BY ms.name ASC`,
      [profileId],
    );
    return rows.map(serializeProfileDetailServer);
  }

  upsertProfileServer(
    profileId: string,
    serverId: string,
    data: { enabled?: boolean; disabledTools?: string[] },
  ): ProfileServerRow {
    const existing = this.db.queryOne(
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
      this.db.run(
        "UPDATE profile_servers SET enabled = ?, disabled_tools = ? WHERE profile_id = ? AND server_id = ?",
        [enabled, disabledTools, profileId, serverId],
      );
    } else {
      this.db.run(
        "INSERT INTO profile_servers (profile_id, server_id, enabled, disabled_tools) VALUES (?, ?, ?, ?)",
        [profileId, serverId, enabled, disabledTools],
      );
    }
    const row = this.db.queryOne(
      "SELECT * FROM profile_servers WHERE profile_id = ? AND server_id = ?",
      [profileId, serverId],
    );
    return serializeProfileServerState(
      requireRow(row, "Profile server state could not be reloaded"),
    );
  }

  findActiveProfileServerIds(): string[] {
    const activeId = this.findActiveId();
    if (!activeId) return [];
    const rows = this.db.queryAll(
      "SELECT server_id FROM profile_servers WHERE profile_id = ? AND enabled = 1",
      [activeId],
    );
    return rows.map((row) => String(row.server_id));
  }

  assignToActiveProfile(serverIds: string[]): void {
    const activeProfile = this.db.queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
    if (!activeProfile) return;
    for (const serverId of serverIds) {
      this.db.run(
        "INSERT OR IGNORE INTO profile_servers (profile_id, server_id, enabled, disabled_tools) VALUES (?, ?, 1, '[]')",
        [activeProfile.id, serverId],
      );
    }
  }

  seedDefault(): void {
    const rows = this.db.queryAll("SELECT id FROM profiles WHERE name = 'Default'", []);
    const now = new Date().toISOString();
    this.db.run("UPDATE profiles SET is_active = 0", []);
    if (rows.length === 0) {
      this.db.run(
        "INSERT INTO profiles (id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
        [crypto.randomUUID(), "Default", now, now],
      );
    } else {
      this.db.run("UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?", [
        now,
        rows[0].id,
      ]);
    }
  }
}

export function getProfileRepository(): ProfileRepository {
  return new ProfileRepository(getDatabase());
}
