import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  parseCodexTomlConfig,
  parseJsonMcpConfig,
  type ScannedServer,
} from "../config/import-parser.js";
import { scanAllConfigs } from "../config/scanner.js";
import { generateSnippets } from "../config/snippets.js";
import { FORMATTERS } from "../config/formatters.js";
import { getClientById, ALL_CLIENTS } from "../config/clients.js";
import { importApi, selectImportCandidates } from "./import.js";

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
    const cursor = snippets.find((snippet) => snippet.client === "Cursor");

    expect(snippets.map((snippet) => snippet.client)).toEqual([
      "Claude Code",
      "Codex",
      "OpenCode",
      "Cursor",
    ]);
    expect(codex?.snippet).toContain("[mcp_servers.moor]");
    expect(codex?.snippet).toContain('url = "http://127.0.0.1:9223/mcp"');
    expect(openCode?.snippet).toContain('"mcp"');
    expect(openCode?.snippet).toContain('"type": "remote"');
    expect(cursor?.snippet).toContain("mcpServers");
    expect(cursor?.snippet).toContain('"moor"');
    expect(allSnippetText).not.toContain("3000");
    expect(allSnippetText).not.toContain("X-Moor-Token");
    expect(allSnippetText).not.toContain('"headers"');
  });

  it("parses Cursor stdio and HTTP MCP configs", () => {
    const parsed = parseJsonMcpConfig(
      JSON.stringify({
        mcpServers: {
          "local-tool": {
            type: "stdio",
            command: "npx",
            args: ["-y", "my-mcp-server"],
            env: { API_KEY: "test" },
          },
          "remote-tool": {
            url: "https://mcp.example.com/mcp",
          },
        },
      }),
      "cursor",
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.servers).toHaveLength(2);
    expect(parsed.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "local-tool",
          connectionType: "stdio",
          command: "npx",
          args: ["-y", "my-mcp-server"],
          env: { API_KEY: "test" },
        }),
        expect.objectContaining({
          name: "remote-tool",
          connectionType: "http",
          url: "https://mcp.example.com/mcp",
        }),
      ]),
    );
  });

  it("scans Cursor config alongside other clients", () => {
    tempHome = mkdtempSync(path.join(tmpdir(), "moor-import-home-"));
    process.env.HOME = tempHome;
    mkdirSync(path.join(tempHome, ".claude"), { recursive: true });
    mkdirSync(path.join(tempHome, ".codex"), { recursive: true });
    mkdirSync(path.join(tempHome, ".config", "opencode"), { recursive: true });
    mkdirSync(path.join(tempHome, ".cursor"), { recursive: true });

    writeFileSync(path.join(tempHome, ".claude", "settings.json"), '{"permissions": {}}');
    writeFileSync(path.join(tempHome, ".codex", "config.toml"), 'model = "gpt-5.4"');
    writeFileSync(path.join(tempHome, ".config", "opencode", "opencode.json"), '{"theme": "dark"}');
    writeFileSync(
      path.join(tempHome, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          test: { command: "npx", args: ["-y", "test-server"] },
        },
      }),
    );

    const result = scanAllConfigs();
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toEqual(
      expect.objectContaining({
        name: "test",
        connectionType: "stdio",
        command: "npx",
        source: "cursor",
      }),
    );
  });
});

describe("Config formatters", () => {
  const servers: ScannedServer[] = [
    {
      name: "my-stdio",
      connectionType: "stdio",
      command: "npx",
      args: ["-y", "my-server"],
      env: { KEY: "val" },
      source: "test",
    },
    {
      name: "my-http",
      connectionType: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer token" },
      source: "test",
    },
  ];

  it("formats for Claude Code", () => {
    const client = getClientById("claude-code")!;
    const result = FORMATTERS["claude-code"](servers, client);
    const parsed = JSON.parse(result.content);

    expect(parsed.mcpServers["my-stdio"]).toEqual({
      command: "npx",
      args: ["-y", "my-server"],
      env: { KEY: "val" },
    });
    expect(parsed.mcpServers["my-http"]).toEqual({
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer token" },
    });
  });

  it("formats for Codex as TOML", () => {
    const client = getClientById("codex")!;
    const result = FORMATTERS.codex(servers, client);

    expect(result.content).toContain("[mcp_servers.my-stdio]");
    expect(result.content).toContain('command = "npx"');
    expect(result.content).toContain("[mcp_servers.my-http]");
    expect(result.content).toContain('url = "https://mcp.example.com/mcp"');
    expect(result.content).toContain("enabled = true");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("http_headers")]),
    );
  });

  it("preserves Codex cwd for stdio servers", () => {
    const client = getClientById("codex")!;
    const result = FORMATTERS.codex(
      [
        {
          name: "project-tool",
          connectionType: "stdio",
          command: "node",
          args: ["server.js"],
          workingDir: "/tmp/project",
          source: "test",
        },
      ],
      client,
    );

    expect(result.content).toContain('cwd = "/tmp/project"');

    const parsed = parseCodexTomlConfig(result.content, "codex-roundtrip");
    expect(parsed.errors).toEqual([]);
    expect(parsed.servers[0]).toEqual(
      expect.objectContaining({
        name: "project-tool",
        workingDir: "/tmp/project",
      }),
    );
  });

  it("formats Codex TOML that can be parsed back with quoted server names", () => {
    const client = getClientById("codex")!;
    const result = FORMATTERS.codex(
      [
        {
          name: "my.server with space",
          connectionType: "http",
          url: "https://mcp.example.com/mcp",
          headers: {
            Authorization: "Bearer {env:API_TOKEN}",
            "X-Static": "static",
            "X-Env": "${env:HEADER_TOKEN}",
          },
          source: "test",
        },
      ],
      client,
    );

    expect(result.content).toContain('[mcp_servers."my.server with space"]');
    expect(result.content).toContain('bearer_token_env_var = "API_TOKEN"');
    expect(result.content).toContain('http_headers = { "X-Static" = "static" }');
    expect(result.content).toContain('env_http_headers = { "X-Env" = "HEADER_TOKEN" }');

    const parsed = parseCodexTomlConfig(result.content, "codex-roundtrip");
    expect(parsed.errors).toEqual([]);
    expect(parsed.servers).toEqual([
      expect.objectContaining({
        name: "my.server with space",
        connectionType: "http",
        url: "https://mcp.example.com/mcp",
        headers: {
          Authorization: "Bearer {env:API_TOKEN}",
          "X-Static": "static",
          "X-Env": "{env:HEADER_TOKEN}",
        },
      }),
    ]);
  });

  it("rewrites env header placeholders for JSON clients", () => {
    const headerServers: ScannedServer[] = [
      {
        name: "env-http",
        connectionType: "http",
        url: "https://mcp.example.com/mcp",
        headers: {
          Authorization: "Bearer {env:API_TOKEN}",
          "X-Cursor": "${env:CURSOR_TOKEN}",
          "X-Claude": "${CLAUDE_TOKEN}",
          "X-Static": "static",
        },
        source: "test",
      },
    ];

    const claude = JSON.parse(
      FORMATTERS["claude-code"](headerServers, getClientById("claude-code")!).content,
    );
    const cursor = JSON.parse(FORMATTERS.cursor(headerServers, getClientById("cursor")!).content);
    const opencode = JSON.parse(
      FORMATTERS.opencode(headerServers, getClientById("opencode")!).content,
    );

    expect(claude.mcpServers["env-http"].headers).toEqual({
      Authorization: "Bearer ${API_TOKEN}",
      "X-Cursor": "${CURSOR_TOKEN}",
      "X-Claude": "${CLAUDE_TOKEN}",
      "X-Static": "static",
    });
    expect(cursor.mcpServers["env-http"].headers).toEqual({
      Authorization: "Bearer ${env:API_TOKEN}",
      "X-Cursor": "${env:CURSOR_TOKEN}",
      "X-Claude": "${env:CLAUDE_TOKEN}",
      "X-Static": "static",
    });
    expect(opencode.mcp["env-http"].headers).toEqual({
      Authorization: "Bearer {env:API_TOKEN}",
      "X-Cursor": "{env:CURSOR_TOKEN}",
      "X-Claude": "{env:CLAUDE_TOKEN}",
      "X-Static": "static",
    });
  });

  it("formats for OpenCode with type field", () => {
    const client = getClientById("opencode")!;
    const result = FORMATTERS.opencode(servers, client);
    const parsed = JSON.parse(result.content);

    expect(parsed.$schema).toBe("https://opencode.ai/config.json");
    expect(parsed.mcp["my-stdio"]).toEqual({
      type: "local",
      command: ["npx", "-y", "my-server"],
      environment: { KEY: "val" },
      enabled: true,
    });
    expect(parsed.mcp["my-http"]).toEqual({
      type: "remote",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer token" },
      enabled: true,
    });
  });

  it("formats for Cursor with type field", () => {
    const client = getClientById("cursor")!;
    const result = FORMATTERS.cursor(servers, client);
    const parsed = JSON.parse(result.content);

    expect(parsed.mcpServers["my-stdio"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "my-server"],
      env: { KEY: "val" },
    });
    expect(parsed.mcpServers["my-http"]).toEqual({
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer token" },
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("streamable-http")]),
    );
  });

  it("client registry has all four clients", () => {
    expect(ALL_CLIENTS).toHaveLength(4);
    expect(ALL_CLIENTS.map((c) => c.id)).toEqual(["claude-code", "codex", "opencode", "cursor"]);
  });
});

describe("convert API validation", () => {
  async function postConvert(body: unknown): Promise<Response> {
    return importApi.request("/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects invalid convert request fields with 400", async () => {
    const invalidSource = await postConvert({
      source: "invalid",
      targetClient: "cursor",
    });
    expect(invalidSource.status).toBe(400);
    await expect(invalidSource.json()).resolves.toEqual({
      error: expect.stringContaining("source"),
    });

    const invalidTarget = await postConvert({
      source: "paste",
      sourceClient: "claude-code",
      targetClient: "unknown",
      content: '{"mcpServers":{}}',
    });
    expect(invalidTarget.status).toBe(400);
    await expect(invalidTarget.json()).resolves.toEqual({
      error: expect.stringContaining("targetClient"),
    });

    const invalidServerIds = await postConvert({
      source: "moor",
      targetClient: "cursor",
      serverIds: "not-array",
    });
    expect(invalidServerIds.status).toBe(400);
    await expect(invalidServerIds.json()).resolves.toEqual({
      error: expect.stringContaining("serverIds"),
    });
  });

  it("rejects oversized convert content with 413", async () => {
    const response = await postConvert({
      source: "paste",
      sourceClient: "claude-code",
      targetClient: "cursor",
      content: "x".repeat(512 * 1024 + 1),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "content exceeds maximum allowed size",
    });
  });

  it("converts a valid pasted config", async () => {
    const response = await postConvert({
      source: "paste",
      sourceClient: "claude-code",
      targetClient: "cursor",
      content: JSON.stringify({
        mcpServers: {
          remote: {
            url: "https://mcp.example.com/mcp",
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.content).toContain('"remote"');
    expect(body.targetClient).toBe("cursor");
  });

  it("reports unsupported pasted entries as conversion warnings", async () => {
    const response = await postConvert({
      source: "paste",
      sourceClient: "claude-code",
      targetClient: "cursor",
      content: JSON.stringify({
        mcpServers: {
          remote: {
            url: "https://mcp.example.com/mcp",
          },
          openapi: {
            type: "openapi",
            openapi: { url: "https://example.com/openapi.json" },
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.content).toContain('"remote"');
    expect(body.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Skipped unsupported server "openapi"')]),
    );
  });

  it("reports pasted parse errors instead of hiding them", async () => {
    const response = await postConvert({
      source: "paste",
      sourceClient: "claude-code",
      targetClient: "cursor",
      content: '{"mcpServers":',
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining("Parse error"),
    });
  });
});
