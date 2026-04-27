interface ClientSnippet {
  client: string;
  description: string;
  snippet: string;
  cliCommand: string;
}

export function generateSnippets(port: number): ClientSnippet[] {
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;

  return [
    {
      client: "Claude Code",
      description: "Add to ~/.claude/settings.json → mcpServers",
      snippet: JSON.stringify({
        mcpServers: {
          moor: { url: mcpUrl },
        },
      }, null, 2),
      cliCommand: `# Edit ~/.claude/settings.json and add to mcpServers:\n"moor": { "url": "${mcpUrl}" }`,
    },
    {
      client: "Cursor",
      description: "Add to .cursor/mcp.json → mcpServers",
      snippet: JSON.stringify({
        mcpServers: {
          moor: { url: mcpUrl },
        },
      }, null, 2),
      cliCommand: `# Edit .cursor/mcp.json and add to mcpServers:\n"moor": { "url": "${mcpUrl}" }`,
    },
    {
      client: "Codex",
      description: "Configure in Codex settings",
      snippet: JSON.stringify({
        mcpServers: {
          moor: { url: mcpUrl },
        },
      }, null, 2),
      cliCommand: `# Add MCP server in Codex settings:\nURL: ${mcpUrl}`,
    },
    {
      client: "OpenCode",
      description: "Add to OpenCode MCP configuration",
      snippet: JSON.stringify({
        mcpServers: {
          moor: { url: mcpUrl },
        },
      }, null, 2),
      cliCommand: `# Configure in OpenCode settings:\nURL: ${mcpUrl}`,
    },
  ];
}
