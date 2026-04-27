import { Hono } from "hono";
import { aggregator } from "./aggregator.js";
import { serverManager } from "../services/server-manager.js";
import { getAuditLogger } from "../services/audit-logger.js";
import { queryOne } from "../db/index.js";
import type { JsonRpcRequest } from "./types.js";

const gateway = new Hono();

gateway.all("/mcp", async (c) => {
  const body = await c.req.json<JsonRpcRequest>().catch(() => null);
  if (!body || body.jsonrpc !== "2.0") {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }, 400);
  }

  const { method, params, id } = body;
  const profileId = aggregator.getActiveProfileId();
  const agentInfo = c.req.header("user-agent") ?? null;
  const startTime = Date.now();

  try {
    let result: unknown;

    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "Moor", version: "0.1.0" },
        };
        break;

      case "notifications/initialized":
        return new Response(null, { status: 204 });

      case "tools/list":
        result = { tools: aggregator.getAggregatedTools() };
        break;

      case "tools/call": {
        const toolName = (params as Record<string, unknown>)?.name as string;
        const toolArgs = (params as Record<string, unknown>)?.arguments;
        const owner = aggregator.findToolOwner(toolName);

        if (!owner) {
          result = { content: [{ type: "text", text: `Tool "${toolName}" not found or disabled` }], isError: true };
        } else {
          const server = serverManager.getServer(owner.serverId);
          if (!server || server.status !== "running") {
            result = { content: [{ type: "text", text: `Server "${owner.serverName}" is not running` }], isError: true };
          } else {
            const response = await callToolOnServer(owner.serverId, toolName, toolArgs);
            result = response;
            getAuditLogger().log({
              profileId, serverId: owner.serverId, toolName, arguments: toolArgs,
              result: response, error: null, durationMs: Date.now() - startTime, agentInfo,
            });
          }
        }
        break;
      }

      case "resources/list":
        result = { resources: [] };
        break;

      case "ping":
        result = {};
        break;

      default:
        return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }

    return c.json({ jsonrpc: "2.0", id, result });
  } catch (err) {
    getAuditLogger().log({
      profileId, serverId: null, toolName: method, arguments: params,
      result: null, error: (err as Error).message, durationMs: Date.now() - startTime, agentInfo,
    });

    return c.json({ jsonrpc: "2.0", id, error: { code: -32603, message: (err as Error).message } });
  }
});

async function callToolOnServer(serverId: string, toolName: string, args: unknown): Promise<unknown> {
  const row = queryOne("SELECT connection_type, command, args, url, env, working_dir FROM mcp_servers WHERE id = ?", [serverId]);
  if (!row) throw new Error(`Server ${serverId} not found`);

  if (row.connection_type === "http" && row.url) {
    const transport = new (await import("./transports/http.js")).HttpTransport(row.url as string);
    await transport.connect();
    try {
      const response = await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: args } });
      return response.result;
    } finally { await transport.disconnect(); }
  } else if (row.connection_type === "stdio" && row.command) {
    const transport = new (await import("./transports/stdio.js")).StdioTransport(
      row.command as string,
      row.args ? JSON.parse(row.args as string) : [],
      row.env ? JSON.parse(row.env as string) : {},
      (row.working_dir as string) || undefined
    );
    await transport.connect();
    try {
      const response = await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: args } });
      return response.result;
    } finally { await transport.disconnect(); }
  }

  throw new Error("Unsupported server configuration");
}

export { gateway };
