interface ClientSnippet {
  client: string;
  description: string;
  snippet: string;
  cliCommand: string;
}

export function generateSnippets(mcpUrl: string): ClientSnippet[] {
  return [
    {
      client: "Claude Code",
      description: "Add to ~/.claude/settings.json → mcpServers",
      snippet: JSON.stringify(
        {
          mcpServers: {
            moor: { url: mcpUrl },
          },
        },
        null,
        2,
      ),
      cliCommand: `# Edit ~/.claude/settings.json and add to mcpServers:\n"moor": { "url": "${mcpUrl}" }`,
    },
    {
      client: "Codex",
      description: "Add to ~/.codex/config.toml or project .codex/config.toml",
      snippet: `[mcp_servers.moor]\nurl = "${mcpUrl}"\nenabled = true`,
      cliCommand: `# Edit ~/.codex/config.toml and add:\n[mcp_servers.moor]\nurl = "${mcpUrl}"\nenabled = true`,
    },
    {
      client: "OpenCode",
      description: "Add to ~/.config/opencode/opencode.json or project opencode.json",
      snippet: JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            moor: {
              type: "remote",
              url: mcpUrl,
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
      cliCommand: `# Edit ~/.config/opencode/opencode.json and add the "mcp.moor" entry above.`,
    },
    {
      client: "Cursor",
      description: "Add to ~/.cursor/mcp.json or project .cursor/mcp.json",
      snippet: JSON.stringify(
        {
          mcpServers: {
            moor: {
              url: mcpUrl,
            },
          },
        },
        null,
        2,
      ),
      cliCommand: `# Edit ~/.cursor/mcp.json and add the mcpServers.moor entry above.`,
    },
  ];
}
