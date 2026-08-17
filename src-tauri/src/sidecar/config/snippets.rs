use super::clients;
use super::formatters;
use super::import_parser::ScannedServer;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSnippet {
    pub client: String,
    pub description: String,
    pub snippet: String,
    pub cli_command: String,
}

pub fn generate_snippets(mcp_url: &str) -> Vec<ClientSnippet> {
    let moor_server = ScannedServer {
        name: "moor".to_string(),
        connection_type: "http".to_string(),
        url: Some(mcp_url.to_string()),
        source: "moor".to_string(),
        command: None,
        args: None,
        env: None,
        headers: None,
        working_dir: None,
    };

    clients::ALL_CLIENTS
        .iter()
        .map(|client| {
            let formatter = formatters::format_for_client(client.id)
                .unwrap_or(formatters::format_for_claude_code);
            // Kimi Code / dsh use the moor-mcp entry name so pasting takes over the
            // hand-written entry instead of creating a second gateway connection.
            let server = if client.id == "kimi-code" || client.id == "dsh" {
                let mut s = moor_server.clone();
                s.name = "moor-mcp".to_string();
                s
            } else {
                moor_server.clone()
            };
            let result = formatter(std::slice::from_ref(&server), client);
            let paths = clients::resolve_config_paths(client);
            if client.id == "dsh" {
                return ClientSnippet {
                    client: client.name.to_string(),
                    description: client.description.to_string(),
                    snippet: format!(
                        "# ===== Moor MCP Gateway (managed) =====\n{}\n# ===== end Moor MCP Gateway =====",
                        result.content
                    ),
                    cli_command: format!(
                        "# Append the marked section above to the end of {} (kept HMR-hot by dsh).",
                        paths[0].display()
                    ),
                };
            }
            ClientSnippet {
                client: client.name.to_string(),
                description: client.description.to_string(),
                snippet: result.content,
                cli_command: format!(
                    "# Edit {} and add the {}.{} entry above.",
                    paths[0].display(),
                    client.top_level_key,
                    server.name
                ),
            }
        })
        .collect()
}
