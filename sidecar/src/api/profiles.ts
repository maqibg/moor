import { Hono } from "hono";
import { run, queryAll, queryOne } from "../db/index.js";
import { serializeProfile, serializeProfileServer, serializeServer } from "../db/serializers.js";
import { eventBus } from "../services/event-bus.js";

const profiles = new Hono();

profiles.get("/", (c) => {
  const rows = queryAll(
    `
    SELECT p.*, COUNT(ps.server_id) as server_count
    FROM profiles p
    LEFT JOIN profile_servers ps ON p.id = ps.profile_id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `,
    [],
  );
  return c.json(rows.map(serializeProfile));
});

profiles.post("/", (c) => {
  return c.req.json().then((body: { name?: string }) => {
    if (!body.name) return c.json({ error: "name is required" }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    run(
      "INSERT INTO profiles (id, name, is_active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
      [id, body.name, now, now],
    );
    const row = queryOne("SELECT * FROM profiles WHERE id = ?", [id]);
    return c.json(serializeProfile(row ?? {}), 201);
  });
});

profiles.get("/:id", (c) => {
  const id = c.req.param("id");
  const profile = queryOne(
    `
    SELECT p.*, COUNT(ps.server_id) as server_count
    FROM profiles p
    LEFT JOIN profile_servers ps ON p.id = ps.profile_id
    WHERE p.id = ?
    GROUP BY p.id
  `,
    [id],
  );
  if (!profile) return c.json({ error: "Profile not found" }, 404);

  const servers = queryAll(
    `
    SELECT
      ms.*,
      ps.profile_id,
      ps.enabled,
      ps.disabled_tools
    FROM mcp_servers ms
    LEFT JOIN profile_servers ps ON ps.server_id = ms.id AND ps.profile_id = ?
    ORDER BY ms.name ASC
  `,
    [id],
  ).map((row) => {
    const enabled = row.enabled ?? 0;
    const disabledTools = row.disabled_tools ?? "[]";
    return {
      ...serializeServer(row),
      profile_server: serializeProfileServer({
        profile_id: id,
        server_id: row.id,
        enabled,
        disabled_tools: disabledTools,
      }),
    };
  });

  return c.json({ ...serializeProfile(profile), servers });
});

profiles.put("/:id", (c) => {
  return c.req.json().then((body: { name?: string }) => {
    const id = c.req.param("id");
    const existing = queryOne("SELECT id FROM profiles WHERE id = ?", [id]);
    if (!existing) return c.json({ error: "Profile not found" }, 404);
    if (body.name) {
      run("UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?", [
        body.name,
        new Date().toISOString(),
        id,
      ]);
    }
    const row = queryOne("SELECT * FROM profiles WHERE id = ?", [id]);
    return c.json(serializeProfile(row ?? {}));
  });
});

profiles.delete("/:id", (c) => {
  const id = c.req.param("id");
  const existing = queryOne("SELECT id, is_active FROM profiles WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Profile not found" }, 404);
  if (existing.is_active) return c.json({ error: "Cannot delete active profile" }, 400);
  run("DELETE FROM profiles WHERE id = ?", [id]);
  return c.json({ success: true });
});

profiles.put("/:id/activate", (c) => {
  const id = c.req.param("id");
  const existing = queryOne("SELECT id FROM profiles WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Profile not found" }, 404);
  run("UPDATE profiles SET is_active = 0");
  run("UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
  eventBus.emit("profile:activated", { type: "profile:activated", data: { profileId: id } });
  const row = queryOne("SELECT * FROM profiles WHERE id = ?", [id]);
  return c.json(serializeProfile(row ?? {}));
});

profiles.put("/:id/servers/:sid", (c) => {
  return c.req.json().then((body: { enabled?: boolean; disabledTools?: string[] }) => {
    const profileId = c.req.param("id");
    const serverId = c.req.param("sid");
    const existing = queryOne(
      "SELECT * FROM profile_servers WHERE profile_id = ? AND server_id = ?",
      [profileId, serverId],
    );
    const enabled =
      body.enabled !== undefined
        ? body.enabled
          ? 1
          : 0
        : existing
          ? (existing.enabled as number)
          : 1;
    const disabledTools =
      body.disabledTools !== undefined
        ? JSON.stringify(body.disabledTools)
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
    return c.json(serializeProfileServer(row ?? {}));
  });
});

export { profiles };
