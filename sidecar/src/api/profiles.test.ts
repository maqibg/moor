import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { closeDb, initDb, runMigrations } from "../db/index.js";
import { getServerRepository } from "../db/server-repository.js";
import { profileService } from "../services/profiles.js";
import { serverManager } from "../services/server-manager.js";
import { profiles } from "./profiles.js";

let dataDir: string;

async function activeProfileId(): Promise<string> {
  const id = profileService.getActiveProfileId();
  if (!id) throw new Error("active profile missing");
  return id;
}

describe("profiles API detail payload", () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "moor-profiles-api-"));
    await initDb({ dataDir });
    runMigrations();
    profileService.seedDefault();
    serverManager.resetForTest();
    serverManager.loadFromDb();
  });

  afterEach(async () => {
    await serverManager.stopAll();
    serverManager.resetForTest();
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns complete servers with profile state for bound and unbound servers", async () => {
    const bound = serverManager.addServer({
      name: "bound",
      connectionType: "stdio",
      command: "node",
      args: ["server.js"],
    });
    const now = new Date().toISOString();
    getServerRepository().insert({
      id: "unbound-server",
      name: "unbound",
      connectionType: "http",
      command: null,
      args: null,
      url: "https://mcp.example.com/mcp",
      env: null,
      headers: null,
      workingDir: null,
      autoStart: 0,
      sortOrder: -1,
      createdAt: now,
      updatedAt: now,
    });
    serverManager.registerServer("unbound-server");

    const response = await profiles.request(`/${await activeProfileId()}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.servers).toHaveLength(2);
    expect(body.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bound.id,
          name: "bound",
          connectionType: "stdio",
          command: "node",
          args: ["server.js"],
          profileServer: {
            enabled: true,
            disabledTools: [],
          },
        }),
        expect.objectContaining({
          id: "unbound-server",
          name: "unbound",
          connectionType: "http",
          url: "https://mcp.example.com/mcp",
          profileServer: {
            enabled: false,
            disabledTools: [],
          },
        }),
      ]),
    );
  });

  it("binds servers created through serverManager.addServer to the active profile", async () => {
    const server = serverManager.addServer({
      name: "managed",
      connectionType: "http",
      url: "https://mcp.example.com/mcp",
    });

    const response = await profiles.request(`/${await activeProfileId()}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.servers).toContainEqual(
      expect.objectContaining({
        id: server.id,
        profileServer: {
          enabled: true,
          disabledTools: [],
        },
      }),
    );
  });

  it("returns profile server state without undefined-derived fields after updates", async () => {
    const server = serverManager.addServer({
      name: "tools",
      connectionType: "stdio",
      command: "node",
    });
    const profileId = await activeProfileId();

    const response = await profiles.request(`/${profileId}/servers/${server.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, disabledTools: ["read_file"] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      serverId: server.id,
      enabled: true,
      disabledTools: ["read_file"],
    });
  });
});
