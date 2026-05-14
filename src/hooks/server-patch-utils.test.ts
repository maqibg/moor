import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  applyServerAction,
  mergeServerStatusEvent,
  syncUpdatedServerCaches,
  type ServerStateItem,
} from "./server-patch-utils";
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

describe("useServers state helpers", () => {
  it("marks a server as starting when start is requested", () => {
    const servers = [server(), server({ id: "server-2" })];

    expect(applyServerAction(servers, "server-1", "starting")).toEqual([
      server({ status: "starting", errorMessage: null }),
      server({ id: "server-2" }),
    ]);
  });

  it("keeps runtime status while clearing previous errors when stop is requested", () => {
    const servers = [server({ status: "running", errorMessage: "previous error" })];

    expect(applyServerAction(servers, "server-1", "stopping")).toEqual([
      server({ status: "running", errorMessage: null }),
    ]);
  });

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
