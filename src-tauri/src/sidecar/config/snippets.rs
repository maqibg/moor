use super::clients;
use super::formatters;
use super::import_parser::ScannedServer;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSnippet {
    pub client_id: String,
    pub client: String,
    pub description: String,
    pub snippet: String,
    pub cli_command: String,
}

pub fn generate_snippets(mcp_url: &str) -> Result<Vec<ClientSnippet>, String> {
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
            let formatter = formatters::format_for_client(client.id).ok_or_else(|| {
                // 由 every_registered_client_has_a_formatter 护栏保证；绝不
                // 静默回退到别的方言格式。
                format!("no formatter registered for client: {}", client.id)
            })?;
            let mut server = moor_server.clone();
            server.name = client.gateway_entry_name.to_string();
            let result = formatter(std::slice::from_ref(&server), client);
            let paths = clients::resolve_config_paths(client);
            if client.id == "dsh" {
                return Ok(ClientSnippet {
                    client_id: client.id.to_string(),
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
                });
            }
            Ok(ClientSnippet {
                client_id: client.id.to_string(),
                client: client.name.to_string(),
                description: client.description.to_string(),
                snippet: result.content,
                cli_command: format!(
                    "# Edit {} and add the {}.{} entry above.",
                    paths[0].display(),
                    client.top_level_key,
                    server.name
                ),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippets_carry_registry_client_id() {
        let snippets = generate_snippets("http://127.0.0.1:9223/mcp").expect("snippets");
        assert_eq!(snippets.len(), clients::ALL_CLIENTS.len());
        for snippet in &snippets {
            assert!(
                clients::get_client_by_id(&snippet.client_id).is_some(),
                "snippet client_id `{}` must be a registry id",
                snippet.client_id
            );
            assert!(!snippet.snippet.is_empty());
        }
    }

    #[test]
    fn gateway_entry_names_drive_snippet_entry() {
        let snippets = generate_snippets("http://127.0.0.1:9223/mcp").expect("snippets");
        for (snippet, client) in snippets.iter().zip(clients::ALL_CLIENTS.iter()) {
            let entry = format!("\"{}\"", client.gateway_entry_name);
            if client.format == "json" {
                assert!(
                    snippet.snippet.contains(&entry),
                    "{} snippet should key on {}",
                    client.id,
                    client.gateway_entry_name
                );
            }
        }
    }
}
