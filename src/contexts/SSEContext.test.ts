import { describe, expect, it } from "vite-plus/test";
import { QueryClient } from "@tanstack/react-query";
import { serverKeys } from "@/lib/query-keys";
import type { Server, ServerHealth } from "@moor/types";
import { applyMoorEventToQueryCache, parseMoorSSEEvent } from "./SSEContext";

describe("parseMoorSSEEvent", () => {
  it("accepts valid typed event payloads", () => {
    const warnings: string[] = [];

    expect(
      parseMoorSSEEvent(
        "server:status",
        { serverId: "server-1", status: "running", errorMessage: null },
        (message) => warnings.push(message),
      ),
    ).toEqual({
      type: "server:status",
      data: { serverId: "server-1", status: "running", errorMessage: null },
    });
    expect(warnings).toEqual([]);
  });

  it("ignores the initial connected event without warning", () => {
    const warnings: string[] = [];

    expect(
      parseMoorSSEEvent("connected", { timestamp: "2026-05-25T00:00:00.000Z" }, (message) =>
        warnings.push(message),
      ),
    ).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("drops envelope-shaped drifted payloads with a warning", () => {
    const warnings: string[] = [];

    expect(
      parseMoorSSEEvent(
        "server:status",
        {
          type: "server:status",
          data: { serverId: "server-1", status: "running" },
        },
        (message) => warnings.push(message),
      ),
    ).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it("accepts a health snapshot payload", () => {
    const warnings: string[] = [];
    const payload = {
      serverId: "server-1",
      status: "unhealthy",
      checkedAt: "2026-01-01T00:00:00Z",
      consecutiveFailures: 3,
      errorMessage: "ping failed",
    };

    expect(
      parseMoorSSEEvent("server:health", payload, (message) => warnings.push(message)),
    ).toEqual({ type: "server:health", data: payload });
    expect(warnings).toEqual([]);
  });

  it("drops health payloads with an unknown status", () => {
    const warnings: string[] = [];

    expect(
      parseMoorSSEEvent(
        "server:health",
        {
          serverId: "server-1",
          status: "degraded",
          checkedAt: null,
          consecutiveFailures: 0,
          errorMessage: null,
        },
        (message) => warnings.push(message),
      ),
    ).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});

describe("applyMoorEventToQueryCache", () => {
  it("patches server status once at the provider boundary", () => {
    const queryClient = new QueryClient();
    const server: Server = {
      id: "server-1",
      name: "Test",
      connectionType: "stdio",
      status: "stopped",
      autoStart: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    queryClient.setQueryData(serverKeys.list(), [server]);

    applyMoorEventToQueryCache(queryClient, {
      type: "server:status",
      data: { serverId: server.id, status: "running", errorMessage: null },
    });

    expect(queryClient.getQueryData<Server[]>(serverKeys.list())?.[0]?.status).toBe("running");
  });

  it("merges health snapshots into the health cache", () => {
    const queryClient = new QueryClient();
    const previous: ServerHealth[] = [
      {
        serverId: "server-1",
        status: "unknown",
        checkedAt: null,
        consecutiveFailures: 0,
        errorMessage: null,
      },
    ];
    queryClient.setQueryData(serverKeys.health(), previous);

    applyMoorEventToQueryCache(queryClient, {
      type: "server:health",
      data: {
        serverId: "server-1",
        status: "unhealthy",
        checkedAt: "2026-01-01T00:00:00Z",
        consecutiveFailures: 3,
        errorMessage: "ping failed",
      },
    });

    const snapshots = queryClient.getQueryData<ServerHealth[]>(serverKeys.health());
    expect(snapshots).toHaveLength(1);
    expect(snapshots?.[0].status).toBe("unhealthy");
    expect(snapshots?.[0].consecutiveFailures).toBe(3);
  });
});
