import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { serverManager } from "../services/server-manager.js";
import { getAuditLogger } from "../services/audit-logger.js";

declare const APP_VERSION: string;

const gateway = new Hono();

export function createGatewayServer(agentInfo: string | null = null) {
  const server = new Server(
    { name: "Moor", version: APP_VERSION },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: serverManager.getToolCatalog().map((tool) => ({
      name: tool.exposedName,
      description: tool.description,
      inputSchema: tool.inputSchema ?? { type: "object" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolArgs = request.params.arguments ?? {};
    const owner = serverManager.findToolOwner(toolName);
    const profileId = serverManager.getActiveProfileId();
    const startTime = Date.now();

    if (!owner) {
      getAuditLogger().log({
        profileId,
        serverId: null,
        toolName,
        arguments: toolArgs,
        result: null,
        error: `Tool "${toolName}" not found or disabled`,
        durationMs: Date.now() - startTime,
        agentInfo,
      });
      throw new McpError(ErrorCode.InvalidParams, `Tool "${toolName}" not found or disabled`);
    }

    try {
      const result = await serverManager.callToolByExposedName(toolName, toolArgs);
      getAuditLogger().log({
        profileId,
        serverId: owner.serverId,
        toolName,
        arguments: toolArgs,
        result,
        error: null,
        durationMs: Date.now() - startTime,
        agentInfo,
      });
      return result as never;
    } catch (err) {
      getAuditLogger().log({
        profileId,
        serverId: owner.serverId,
        toolName,
        arguments: toolArgs,
        result: null,
        error: (err as Error).message,
        durationMs: Date.now() - startTime,
        agentInfo,
      });
      throw new McpError(ErrorCode.InternalError, (err as Error).message);
    }
  });

  return server;
}

gateway.all("/mcp", async (c) => {
  const server = createGatewayServer(c.req.header("user-agent") ?? null);
  const transport = new StreamableHTTPTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c);
});

export { gateway };
