import { describe, expect, it } from "vite-plus/test";
import { serializeAuditLog, serializeServer, serializeToolDiscovery } from "./serializers.js";

describe("db serializers", () => {
  it("parses JSON fields before API responses", () => {
    expect(
      serializeServer({
        id: "s1",
        name: "filesystem",
        connection_type: "stdio",
        args: '["/tmp"]',
        env: '{"TOKEN":"x"}',
        status: "stopped",
      }).args,
    ).toEqual(["/tmp"]);

    expect(
      serializeToolDiscovery({
        server_id: "s1",
        tool_name: "read",
        exposed_name: "read",
        input_schema: '{"type":"object"}',
      }).input_schema,
    ).toEqual({ type: "object" });

    expect(
      serializeAuditLog({
        id: "l1",
        tool_name: "read",
        arguments: '{"path":"/tmp/a"}',
        result: '{"ok":true}',
      }).result,
    ).toEqual({ ok: true });
  });
});
