import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parseCodexTomlConfig, parseJsonMcpConfig } from "../config/import-parser.js";
import { scanAllConfigs } from "../config/scanner.js";
import { generateSnippets } from "../config/snippets.js";
import { selectImportCandidates } from "./import.js";

const originalHome = process.env.HOME;
let tempHome: string | null = null;

afterEach(() => {
  process.env.HOME = originalHome;
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

describe("selectImportCandidates", () => {
  it("returns only scanned servers not already present by name", () => {
    const candidates = selectImportCandidates(
      [
        { name: "github", connectionType: "stdio", command: "npx", source: "claude-code" },
        {
          name: "linear",
          connectionType: "http",
          url: "http://127.0.0.1:9223/mcp",
          source: "opencode",
        },
      ],
      new Set(["github"]),
    );

    expect(candidates).toEqual([
      {
        name: "linear",
        connectionType: "http",
        url: "http://127.0.0.1:9223/mcp",
        source: "opencode",
      },
    ]);
  });
});

describe("MCP config import parsing", () => {
  it("ignores client config files without MCP sections during scan", () => {
    tempHome = mkdtempSync(path.join(tmpdir(), "moor-import-home-"));
    process.env.HOME = tempHome;
    mkdirSync(path.join(tempHome, ".claude"), { recursive: true });
    mkdirSync(path.join(tempHome, ".codex"), { recursive: true });
    mkdirSync(path.join(tempHome, ".config", "opencode"), { recursive: true });
    writeFileSync(path.join(tempHome, ".claude", "settings.json"), '{"permissions": {}}');
    writeFileSync(path.join(tempHome, ".codex", "config.toml"), 'model = "gpt-5.4"');
    writeFileSync(path.join(tempHome, ".config", "opencode", "opencode.json"), '{"theme": "dark"}');

    expect(scanAllConfigs()).toEqual({
      servers: [],
      unsupported: [],
      errors: [],
      diagnostics: [],
    });
  });

  it("parses supported mcpServers JSON and reports OpenAPI as unsupported", () => {
    const parsed = parseJsonMcpConfig(
      JSON.stringify({
        mcpServers: {
          "stdio-server-example": {
            command: "npx",
            args: ["-y", "mcp-server-example"],
          },
          "sse-server-example": {
            type: "sse",
            url: "http://localhost:3000",
          },
          "http-server-example": {
            type: "streamable-http",
            url: "http://localhost:3001",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer your-token",
            },
          },
          "openapi-server-example": {
            type: "openapi",
            openapi: {
              url: "https://petstore.swagger.io/v2/swagger.json",
            },
          },
        },
      }),
      "json-import",
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.servers).toHaveLength(3);
    expect(parsed.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "stdio-server-example",
          connectionType: "stdio",
          command: "npx",
          args: ["-y", "mcp-server-example"],
        }),
        expect.objectContaining({
          name: "sse-server-example",
          connectionType: "http",
          url: "http://localhost:3000",
        }),
        expect.objectContaining({
          name: "http-server-example",
          connectionType: "http",
          url: "http://localhost:3001",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer your-token",
          },
        }),
      ]),
    );
    expect(parsed.unsupported).toEqual([
      {
        name: "openapi-server-example",
        source: "json-import",
        reason: "OpenAPI-to-MCP is not supported",
      },
    ]);
  });

  it("reports JSON parse diagnostics with line and column details", () => {
    const parsed = parseJsonMcpConfig(
      `{
  "mcpServers": {
    "broken": {
      "command": "npx"
      "args": ["-y", "broken-server"]
    }
  }
}`,
      "json-import",
    );

    expect(parsed.servers).toEqual([]);
    expect(parsed.unsupported).toEqual([]);
    expect(parsed.errors).toEqual(["json-import: JSON parse error at line 5, column 7"]);
    expect(parsed.diagnostics).toEqual([
      {
        source: "json-import",
        message: "CommaExpected",
        code: "CommaExpected",
        line: 5,
        column: 7,
        offset: 65,
        length: 6,
      },
    ]);
  });

  it("parses Codex TOML stdio, HTTP headers, and env-backed headers", () => {
    const parsed = parseCodexTomlConfig(
      `
[mcp_servers.code-review-graph]
command = "uvx"
args = ["code-review-graph", "serve"]
type = "stdio"

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
http_headers = { "X-Figma-Region" = "us-east-1" }
env_http_headers = { "X-API-Key" = "FIGMA_TOKEN" }
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"
`,
      "codex",
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "code-review-graph",
          connectionType: "stdio",
          command: "uvx",
          args: ["code-review-graph", "serve"],
        }),
        expect.objectContaining({
          name: "figma",
          connectionType: "http",
          url: "https://mcp.figma.com/mcp",
          headers: {
            "X-Figma-Region": "us-east-1",
            "X-API-Key": "{env:FIGMA_TOKEN}",
            Authorization: "Bearer {env:FIGMA_OAUTH_TOKEN}",
          },
        }),
      ]),
    );
  });

  it("skips disabled JSON and TOML MCP entries", () => {
    const json = parseJsonMcpConfig(
      JSON.stringify({
        mcp: {
          enabledRemote: {
            type: "remote",
            url: "https://enabled.example.com/mcp",
          },
          disabledRemote: {
            type: "remote",
            url: "https://disabled.example.com/mcp",
            enabled: false,
          },
        },
      }),
      "opencode",
    );
    const toml = parseCodexTomlConfig(
      `
[mcp_servers.enabled_stdio]
command = "uvx"
args = ["enabled-server"]

[mcp_servers.disabled_stdio]
command = "uvx"
args = ["disabled-server"]
enabled = false
`,
      "codex",
    );

    expect(json.errors).toEqual([]);
    expect(json.servers.map((server) => server.name)).toEqual(["enabledRemote"]);
    expect(json.unsupported).toEqual([]);
    expect(toml.errors).toEqual([]);
    expect(toml.servers.map((server) => server.name)).toEqual(["enabled_stdio"]);
    expect(toml.unsupported).toEqual([]);
  });

  it("parses OpenCode JSONC local and remote MCP configs", () => {
    const parsed = parseJsonMcpConfig(
      `
{
  "mcp": {
    "local-docs": {
      "type": "local",
      "command": ["bun", "x", "docs-mcp"],
      "environment": {
        "DOCS_TOKEN": "local"
      },
    },
    "remote-docs": {
      "type": "remote",
      "url": "https://docs.example.com/mcp",
      "headers": {
        "Authorization": "Bearer {env:DOCS_TOKEN}"
      }
    }
  }
}
`,
      "opencode",
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.servers).toEqual([
      {
        name: "local-docs",
        connectionType: "stdio",
        command: "bun",
        args: ["x", "docs-mcp"],
        env: { DOCS_TOKEN: "local" },
        workingDir: undefined,
        source: "opencode",
      },
      {
        name: "remote-docs",
        connectionType: "http",
        url: "https://docs.example.com/mcp",
        headers: { Authorization: "Bearer {env:DOCS_TOKEN}" },
        source: "opencode",
      },
    ]);
  });

  it("generates client snippets without management API tokens", () => {
    const snippets = generateSnippets("http://127.0.0.1:9223/mcp");
    const allSnippetText = snippets.map((snippet) => snippet.snippet).join("\n");
    const codex = snippets.find((snippet) => snippet.client === "Codex");
    const openCode = snippets.find((snippet) => snippet.client === "OpenCode");

    expect(snippets.map((snippet) => snippet.client)).toEqual(["Claude Code", "Codex", "OpenCode"]);
    expect(codex?.snippet).toContain("[mcp_servers.moor]");
    expect(codex?.snippet).toContain('url = "http://127.0.0.1:9223/mcp"');
    expect(openCode?.snippet).toContain('"mcp"');
    expect(openCode?.snippet).toContain('"type": "remote"');
    expect(allSnippetText).not.toContain("3000");
    expect(allSnippetText).not.toContain("X-Moor-Token");
    expect(allSnippetText).not.toContain('"headers"');
  });
});
