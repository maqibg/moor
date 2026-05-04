import { describe, expect, it } from "vite-plus/test";
import { serializeAuditLog, serializeServer, serializeToolDiscovery } from "./serializers.js";

describe("db serializers", () => {
  it("parses JSON fields and converts keys to camelCase", () => {
    expect(
      serializeServer({
        id: "s1",
        name: "filesystem",
        connection_type: "stdio",
        args: '["/tmp"]',
        env: '{"TOKEN":"x"}',
        headers: '{"Authorization":"Bearer {env:TOKEN}"}',
        status: "stopped",
      }),
    ).toMatchObject({
      id: "s1",
      connectionType: "stdio",
      args: ["/tmp"],
      env: { TOKEN: "x" },
      headers: { Authorization: "Bearer {env:TOKEN}" },
    });

    expect(
      serializeServer({
        id: "s2",
        name: "http-only",
        connection_type: "http",
        args: null,
        env: null,
        headers: null,
        auto_start: 0,
        status: "stopped",
      }),
    ).toMatchObject({
      connectionType: "http",
      args: [],
      env: {},
      headers: null,
      autoStart: false,
    });

    expect(
      serializeToolDiscovery({
        server_id: "s1",
        tool_name: "read",
        exposed_name: "read",
        input_schema: '{"type":"object"}',
      }).inputSchema,
    ).toEqual({ type: "object" });

    expect(
      serializeToolDiscovery(
        serializeToolDiscovery({
          server_id: "s1",
          tool_name: "write",
          exposed_name: "write",
          input_schema: '{"type":"object","properties":{"path":{"type":"string"}}}',
        }),
      ).inputSchema,
    ).toEqual({ type: "object", properties: { path: { type: "string" } } });

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
