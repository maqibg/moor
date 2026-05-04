import { describe, expect, it } from "vite-plus/test";
import { applyServerAction, mergeServerStatusEvent, type ServerStateItem } from "./useServersState";

const server = (overrides: Partial<ServerStateItem> = {}): ServerStateItem => ({
  id: "server-1",
  status: "stopped",
  errorMessage: null,
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
});
