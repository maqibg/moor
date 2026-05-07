import { describe, expect, it } from "vite-plus/test";
import { buildToolCatalogFromRows } from "../db/tool-catalog.js";

describe("buildToolCatalogFromRows", () => {
  it("filters disabled tools and exposes duplicate names deterministically", () => {
    const catalog = buildToolCatalogFromRows([
      {
        serverId: "a",
        serverName: "GitHub",
        disabledTools: [],
        toolName: "search",
        description: null,
        inputSchema: null,
      },
      {
        serverId: "b",
        serverName: "Linear MCP",
        disabledTools: [],
        toolName: "search",
        description: null,
        inputSchema: null,
      },
      {
        serverId: "b",
        serverName: "Linear MCP",
        disabledTools: ["archive"],
        toolName: "archive",
        description: null,
        inputSchema: null,
      },
      {
        serverId: "c",
        serverName: "Files",
        disabledTools: [],
        toolName: "read",
        description: null,
        inputSchema: null,
      },
    ]);

    expect(catalog.map((tool) => tool.exposedName)).toEqual([
      "github__search",
      "linear_mcp__search",
      "read",
    ]);
    expect(catalog.find((tool) => tool.exposedName === "linear_mcp__search")).toMatchObject({
      serverId: "b",
      toolName: "search",
    });
  });
});
