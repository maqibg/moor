# Pi Coding Agent Model Context Protocol (MCP)

> Source: https://pi.dev/packages/pi-mcp-adapter
> Additional sources: https://nicobailon-pi-mcp-adapter.mintlify.app/introduction
> Accessed: 2026-08-29
>
> Note: MCP support in Pi is provided by the community-maintained `pi-mcp-adapter` package (github.com/nicobailon/pi-mcp-adapter, MIT), listed in Pi's official package directory — it is not bundled with Pi itself. This document is an external documentation mirror/reference. Copyright belongs to the original site; content may be outdated, please refer to the official links. Follow the original site's license when citing or redistributing.

Pi is a minimal, package-based coding agent. MCP support is added by installing the adapter package:

```bash
pi install npm:pi-mcp-adapter
```

Then restart Pi. The adapter reads standard MCP JSON files automatically; Pi only writes adapter-specific settings.

## Configuration

Servers are defined under `mcpServers` in `mcp.json`, read from (in order):

1. `~/.config/mcp/mcp.json`
2. `~/.agents/mcp.json`
3. `~/.agents/mcp/mcp.json`
4. `<Pi agent dir>/mcp.json` (default `~/.pi/agent/mcp.json`)
5. `.mcp.json` (project, shared convention)
6. `.pi/mcp.json` (project, Pi-specific override — the highest-precedence Pi layer)

Project files override user-global config via shallow merge (server-level replacement). Pi packages can also ship MCP config in `package.json` under `"pi": { "mcp": "./mcp.json" }`.

### Stdio server (local)

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@1.6.0"]
    }
  }
}
```

### HTTP server (remote)

```json
{
  "mcpServers": {
    "dokploy": {
      "url": "http://localhost:3845/mcp"
    }
  }
}
```

`url` connects via Streamable HTTP first with legacy SSE fallback on definitive rejection (404/405/406/415). `command`, `url`, and `socket` (an `rmcp-mux` Unix-domain socket) are mutually exclusive.

### Fields

| Field                                                 | Applies to | Description                                                                                            |
| ----------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `command` / `args`                                    | stdio      | Executable and arguments                                                                               |
| `socket`                                              | socket     | Unix-domain socket (rmcp-mux)                                                                          |
| `url`                                                 | http       | HTTP endpoint (Streamable HTTP, SSE fallback)                                                          |
| `env` / `cwd`                                         | stdio      | Child environment and working directory                                                                |
| `headers`                                             | http       | Static request headers                                                                                 |
| `requestHeadersCommand`                               | http       | Command producing dynamic request headers                                                              |
| `auth`                                                | http       | `"bearer"` or `"oauth"`; OAuth fields: `grantType`, `clientId`, `clientSecret`, `scope`, `redirectUri` |
| `bearerToken` / `bearerTokenEnv` / `bearerTokenStore` | http       | Bearer token value / env var name / storage mode                                                       |
| `lifecycle`                                           | all        | `"lazy"` (default), `"eager"`, `"keep-alive"`, `"lazy-keep-alive"`                                     |
| `idleTimeout`                                         | all        | Idle disconnect in minutes (overrides global)                                                          |
| `requestTimeoutMs`                                    | all        | Per-request timeout in ms (SDK default when omitted or ≤ 0)                                            |
| `protocolVersion`                                     | all        | `"legacy"` (default), `"auto"`, `"2026-07-28"`                                                         |
| `directTools`                                         | all        | `true`, `false`, or string array — call tools directly instead of through the proxy tool               |
| `includeTools` / `excludeTools`                       | all        | Tool allowlist / blocklist                                                                             |
| `toolPrefix`                                          | all        | Prefix applied to tool names                                                                           |
| `disabled`                                            | all        | Only literal `true` disables the server (no `enabled` field)                                           |

## Context-saving model

One `mcp` proxy tool (about 200 tokens) replaces hundreds of tool definitions. Servers are lazy by default — they connect on first tool call, disconnect after the idle timeout, and cache metadata to disk (`~/.pi/agent/mcp-cache.json`) so tool search works offline. Use `directTools` or `lifecycle: "eager"` for servers whose tools should always be in context.

## Host config imports

Imports are explicit only (auto-discovery is off by default via `settings.hostConfigDiscovery: "off"`):

```json
{
  "imports": ["cursor", "claude-code", "claude-desktop", "opencode", "vscode", "windsurf", "codex"]
}
```

## Managing servers

Run `/mcp disable <server>` in Pi to disable a server; the adapter persists it as `disabled: true` in `.pi/mcp.json`.

## Security

- The adapter is community-maintained — review it before granting access to your MCP credentials
- Prefer `bearerTokenEnv` over `bearerToken` so secrets stay out of config files
