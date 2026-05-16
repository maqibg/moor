import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { serverManager } from "../services/server-manager.js";
import { createGatewayServer } from "./gateway.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createGatewayServer", () => {
  it("returns server ownership in tool metadata", async () => {
    vi.stubGlobal("APP_VERSION", "test");
    vi.spyOn(serverManager, "getToolCatalog").mockReturnValue([
      {
        serverId: "server-a",
        serverName: "GitHub",
        toolName: "search",
        exposedName: "github__search",
      },
    ]);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createGatewayServer();
    const client = new Client({ name: "gateway-test", version: "1.0.0" }, { capabilities: {} });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.listTools();

    expect(result.tools[0]).toMatchObject({
      name: "github__search",
      _meta: { serverName: "GitHub" },
    });
    expect(result.tools[0]?.annotations).toBeUndefined();

    await client.close();
    await server.close();
  });
});
