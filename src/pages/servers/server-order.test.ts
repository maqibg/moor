import { describe, expect, it } from "vite-plus/test";
import type { Server } from "@moor/types";
import { getReorderedServers, getServerIds } from "./server-order";

function server(id: string): Server {
  return {
    id,
    name: id,
    connectionType: "stdio",
    status: "stopped",
    autoStart: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("server list ordering helpers", () => {
  it("moves the active server before the drop target", () => {
    const servers = [server("one"), server("two"), server("three")];

    expect(getServerIds(getReorderedServers(servers, "three", "one"))).toEqual([
      "three",
      "one",
      "two",
    ]);
  });

  it("returns the original order for no-op or invalid drag targets", () => {
    const servers = [server("one"), server("two"), server("three")];

    expect(getReorderedServers(servers, "one", "one")).toBe(servers);
    expect(getReorderedServers(servers, "missing", "one")).toBe(servers);
    expect(getReorderedServers(servers, "one", null)).toBe(servers);
  });
});
