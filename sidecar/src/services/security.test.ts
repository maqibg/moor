import { describe, expect, it } from "vite-plus/test";
import { isAllowedOrigin, isLoopbackHost, shouldRequireApiToken } from "./security.js";

describe("security helpers", () => {
  it("accepts only loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1:9223")).toBe(true);
    expect(isLoopbackHost("localhost:9223")).toBe(true);
    expect(isLoopbackHost("evil.test:9223")).toBe(false);
  });

  it("rejects browser origins outside Tauri and dev origins", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("tauri://localhost")).toBe(true);
    expect(isAllowedOrigin("http://localhost:1420")).toBe(true);
    expect(isAllowedOrigin("https://evil.test")).toBe(false);
  });

  it("requires token for management API but not MCP endpoint", () => {
    expect(shouldRequireApiToken("/api/servers")).toBe(true);
    expect(shouldRequireApiToken("/mcp")).toBe(false);
  });
});
