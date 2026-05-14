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
            let result = formatter(std::slice::from_ref(&moor_server), client);
            let paths = clients::resolve_config_paths(client);
            ClientSnippet {
                client: client.name.to_string(),
                description: client.description.to_string(),
                snippet: result.content,
                cli_command: format!(
                    "# Edit {} and add the {}.moor entry above.",
                    paths[0].display(),
                    client.top_level_key
                ),
            }
        })
        .collect()
}
