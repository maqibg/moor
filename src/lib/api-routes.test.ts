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
});
