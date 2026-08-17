import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  failedTransition,
  mergeServerStatusEvent,
  optimisticTransition,
  resolveDisplayStatus,
  syncUpdatedServerCaches,
  type ServerStateItem,
} from "./server-status";
import type { Server } from "@moor/types";

const server = (overrides: Partial<ServerStateItem> = {}): ServerStateItem => ({
  id: "server-1",
  status: "stopped",
  errorMessage: null,
  ...overrides,
});

const storedServer = (overrides: Partial<Server> = {}): Server => ({
  id: "server-1",
  name: "Old Server",
  connectionType: "stdio",
  status: "stopped",
  autoStart: false,
  command: "node",
  args: [],
  url: null,
  env: {},
  headers: null,
  workingDir: null,
  errorMessage: null,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("resolveDisplayStatus", () => {
  it("passes the persisted status through when no action is pending", () => {
    expect(resolveDisplayStatus(server({ status: "running" }))).toEqual({
      status: "running",
      isStarting: false,
      isStopping: false,
    });
  });

  it("keeps the persisted status while a start is requested", () => {
    expect(resolveDisplayStatus(server({ status: "stopped" }), "starting")).toEqual({
      status: "stopped",
      isStarting: true,
      isStopping: false,
    });
  });

  it("flags starting from either the persisted status or the optimistic action", () => {
    expect(resolveDisplayStatus(server({ status: "starting" })).isStarting).toBe(true);
    expect(resolveDisplayStatus(server({ status: "stopped" }), "starting").isStarting).toBe(true);
  });

  it("shows stopping while the underlying status is still running", () => {
    expect(resolveDisplayStatus(server({ status: "running" }), "stopping")).toEqual({
      status: "stopping",
      isStarting: false,
      isStopping: true,
    });
  });

  it("surfaces error status untouched by display synthesis", () => {
    expect(resolveDisplayStatus(server({ status: "error", errorMessage: "boom" }))).toEqual({
      status: "error",
      isStarting: false,
      isStopping: false,
    });
  });
});

describe("optimistic transitions", () => {
  it("derives identical starting patches for both cache channels", () => {
    expect(optimisticTransition("starting")).toEqual({
      list: { status: "starting", errorMessage: null },
      detail: { status: "starting", errorMessage: null },
    });
  });

  it("clears errors on both channels without touching status when stopping", () => {
    expect(optimisticTransition("stopping")).toEqual({
      list: { errorMessage: null },
      detail: { errorMessage: null },
    });
  });

  it("writes failure to both channels with the resolved message", () => {
    expect(failedTransition("spawn failed")).toEqual({
      list: { status: "error", errorMessage: "spawn failed" },
      detail: { status: "error", errorMessage: "spawn failed" },
    });
  });

  it("settles an optimistic start when SSE reports running", () => {
    const starting = [server({ status: "starting", errorMessage: null })];

    expect(
      mergeServerStatusEvent(starting, {
        serverId: "server-1",
        status: "running",
      }),
    ).toEqual([server({ status: "running", errorMessage: null })]);
  });
});

describe("status event merging", () => {
  it("merges error status events into the matching server", () => {
    const servers = [server({ status: "starting" })];

    expect(
      mergeServerStatusEvent(servers, {
        serverId: "server-1",
        status: "error",
        errorMessage: "uvx not found",
      }),
    ).toEqual([server({ status: "error", errorMessage: "uvx not found" })]);
  });

  it("merges parsed status event payloads without reparsing event envelopes", () => {
    const servers = [server({ status: "starting" })];

    expect(
      mergeServerStatusEvent(servers, {
        serverId: "server-1",
        status: "running",
        errorMessage: null,
      }),
    ).toEqual([server({ status: "running", errorMessage: null })]);
  });

  it("clears previous errors when a server reaches running", () => {
    const servers = [server({ status: "error", errorMessage: "uvx not found" })];

    expect(
      mergeServerStatusEvent(servers, {
        serverId: "server-1",
        status: "running",
      }),
    ).toEqual([server({ status: "running", errorMessage: null })]);
  });
});

describe("syncUpdatedServerCaches", () => {
  it("updates list cache and refreshes detail cache after server updates", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const updated = storedServer({
      name: "Updated Server",
      autoStart: true,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    queryClient.setQueryData<Server[]>(["servers"], [storedServer()]);

    await syncUpdatedServerCaches(queryClient, updated, updated.id);

    expect(queryClient.getQueryData<Server[]>(["servers"])).toEqual([updated]);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["servers", updated.id] });
  });
});
