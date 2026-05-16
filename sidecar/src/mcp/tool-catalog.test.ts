import { describe, expect, it } from "vite-plus/test";
import { buildToolCatalogFromRows } from "../db/tool-catalog.js";

describe("buildToolCatalogFromRows", () => {
  it("filters disabled tools and always prefixes exposed names with server slug", () => {
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
      "files__read",
    ]);
    expect(catalog.find((tool) => tool.exposedName === "linear_mcp__search")).toMatchObject({
      serverId: "b",
      toolName: "search",
    });
  });

  it("adds the shortest unique server id prefix when server slugs collide", () => {
    const catalog = buildToolCatalogFromRows([
      {
        serverId: "aaaaaaaa1111",
        serverName: "GitHub MCP",
        disabledTools: [],
        toolName: "search",
        description: null,
        inputSchema: null,
      },
      {
        serverId: "aaaaaaaa2222",
        serverName: "github-mcp",
        disabledTools: [],
        toolName: "search",
        description: null,
        inputSchema: null,
      },
      {
        serverId: "aaaaaaaa3333",
        serverName: "github mcp",
        disabledTools: ["search"],
        toolName: "search",
        description: null,
        inputSchema: null,
      },
    ]);

    expect(catalog.map((tool) => tool.exposedName)).toEqual([
      "github_mcp_aaaaaaaa1__search",
      "github_mcp_aaaaaaaa2__search",
    ]);
  });
});
