import { describe, expect, it } from "vite-plus/test";
import { QueryClient } from "@tanstack/react-query";
import { serverKeys } from "@/lib/query-keys";
import type { Server } from "@moor/types";
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
});
