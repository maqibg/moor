use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct ClientMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub config_path_segments: &'static [&'static [&'static str]],
    pub format: &'static str, // "json" | "toml" | "yaml"
    pub top_level_key: &'static str,
    pub description: &'static str,
}

pub fn resolve_config_paths(client: &ClientMeta) -> Vec<PathBuf> {
    let home = dirs_home();
    client
        .config_path_segments
        .iter()
        .map(|segments| segments.iter().fold(home.clone(), |acc, s| acc.join(s)))
        .collect()
}

fn dirs_home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

pub const ALL_CLIENTS: &[ClientMeta] = &[
    ClientMeta {
        id: "claude-code",
        name: "Claude Code",
        config_path_segments: &[&[".claude", "settings.json"]],
        format: "json",
        top_level_key: "mcpServers",
        description: "Add to ~/.claude/settings.json → mcpServers",
    },
    ClientMeta {
        id: "codex",
        name: "Codex",
        config_path_segments: &[&[".codex", "config.toml"]],
        format: "toml",
        top_level_key: "mcp_servers",
        description: "Add to ~/.codex/config.toml or project .codex/config.toml",
    },
    ClientMeta {
        id: "opencode",
        name: "OpenCode",
        config_path_segments: &[
            &[".config", "opencode", "opencode.json"],
            &[".config", "opencode", "opencode.jsonc"],
        ],
        format: "json",
        top_level_key: "mcp",
        description: "Add to ~/.config/opencode/opencode.json or project opencode.json",
    },
    ClientMeta {
        id: "cursor",
        name: "Cursor",
        config_path_segments: &[&[".cursor", "mcp.json"]],
        format: "json",
        top_level_key: "mcpServers",
        description: "Add to ~/.cursor/mcp.json or project .cursor/mcp.json",
    },
    ClientMeta {
        id: "kimi-code",
        name: "Kimi Code",
        config_path_segments: &[&[".kimi-code", "mcp.json"]],
        format: "json",
        top_level_key: "mcpServers",
        description: "Add to ~/.kimi-code/mcp.json or project .kimi-code/mcp.json",
    },
    // MCP servers are Cordis plugin rows in the home-level patch layer; an
    // invalid patch file makes dsh fail to boot, so snippets are append-only.
    ClientMeta {
        id: "dsh",
        name: "DeepSeek Harness (dsh)",
        config_path_segments: &[&[".dsh", "cordis.patch.yml"]],
        format: "yaml",
        top_level_key: "insert",
        description: "Append to ~/.dsh/cordis.patch.yml (dsh-mcp-client plugin rows)",
    },
];

pub fn get_client_by_id(id: &str) -> Option<&'static ClientMeta> {
    ALL_CLIENTS.iter().find(|c| c.id == id)
}
