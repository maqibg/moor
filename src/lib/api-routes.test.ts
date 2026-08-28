import { describe, expect, it } from "vite-plus/test";
import { routes } from "./api-routes";

describe("api routes", () => {
  it("encodes dynamic path segments and tool query parameters", () => {
    expect(routes.servers.detail("server/1")).toBe("/api/servers/server%2F1");
    expect(routes.profiles.updateServer("profile&1", "server/1")).toBe(
      "/api/profiles/profile%261/servers/server%2F1",
    );
    expect(routes.servers.tools("server/1", "profile&mode=all")).toBe(
      "/api/servers/server%2F1/tools?profile_id=profile%26mode%3Dall",
    );
  });

  it("builds encoded logs query parameters from an object", () => {
    expect(
      routes.logs.list({
        server_id: "server/1",
        tool_name: "read&write",
        from: "2026-01-01T00:00:00Z",
      }),
    ).toBe("/api/logs?server_id=server%2F1&tool_name=read%26write&from=2026-01-01T00%3A00%3A00Z");
  });

  it("encodes insights query", () => {
    expect(routes.logs.insights({ from: "2026-01-01T00:00:00Z" })).toBe(
      "/api/logs/insights?from=2026-01-01T00%3A00%3A00Z",
    );
    expect(routes.logs.insights()).toBe("/api/logs/insights");
  });
});
