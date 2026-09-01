---
"moor": minor
---

feat(clients): add Claude Desktop, Grok Build and Pi client presets

- Client registry adds Claude Desktop (stdio bridged via `npx mcp-remote`), Grok Build (`~/.grok/config.toml`), and Pi (`~/.pi/agent/mcp.json`, requires the community `pi-mcp-adapter` package).
- Claude Code preset renamed to `claude-code` with config path corrected to `~/.claude.json`.
