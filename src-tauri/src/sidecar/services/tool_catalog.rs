use crate::sidecar::db::profile_repo::ProfileRepository;
use crate::sidecar::db::tool_discovery_repo::ToolDiscoveryRepository;
use crate::sidecar::db::Database;
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct ToolCatalogEntry {
    pub server_id: String,
    pub server_name: String,
    pub tool_name: String,
    pub exposed_name: String,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDetail {
    pub tool_name: String,
    pub exposed_name: String,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
    pub disabled: bool,
}

pub struct ToolCatalogService;

impl ToolCatalogService {
    pub fn get_tool_catalog(
        db: &Database,
        profile_id: Option<&str>,
        visible_server_ids: Option<&std::collections::HashSet<String>>,
    ) -> Vec<ToolCatalogEntry> {
        let profile_repo = ProfileRepository::new(db);
        let active_id = match profile_id {
            Some(id) => id.to_string(),
            None => match profile_repo.find_active_id() {
                Ok(Some(id)) => id,
                _ => return vec![],
            },
        };

        let tool_repo = ToolDiscoveryRepository::new(db);
        let profile_tools = match tool_repo.find_by_profile_id(&active_id) {
            Ok(t) => t,
            Err(_) => return vec![],
        };

        let visible = match visible_server_ids {
            Some(ids) => profile_tools
                .into_iter()
                .filter(|t| ids.contains(&t.server_id))
                .collect(),
            None => profile_tools,
        };

        let enabled: Vec<_> = visible
            .into_iter()
            .filter(|t| !t.disabled_tools.contains(&t.tool_name))
            .collect();

        let mut counts = std::collections::HashMap::new();
        for t in &enabled {
            *counts.entry(t.tool_name.clone()).or_insert(0u32) += 1;
        }
        let counts = counts;

        enabled
            .into_iter()
            .map(|t| {
                let duplicate = counts.get(&t.tool_name).copied().unwrap_or(0) > 1;
                let server_slug = normalize_server_name(&t.server_name);
                ToolCatalogEntry {
                    server_id: t.server_id,
                    server_name: t.server_name,
                    tool_name: t.tool_name.clone(),
                    exposed_name: if duplicate {
                        format!("{server_slug}__{}", t.tool_name)
                    } else {
                        t.tool_name
                    },
                    description: t.description,
                    input_schema: t.input_schema,
                }
            })
            .collect()
    }

    pub fn get_tool_details(
        db: &Database,
        server_id: &str,
        profile_id: Option<&str>,
        visible_server_ids: Option<&std::collections::HashSet<String>>,
    ) -> Vec<ToolDetail> {
        let profile_repo = ProfileRepository::new(db);
        let active_id = match profile_id {
            Some(id) => id.to_string(),
            None => match profile_repo.find_active_id() {
                Ok(Some(id)) => id,
                _ => return vec![],
            },
        };

        let tool_repo = ToolDiscoveryRepository::new(db);
        let profile_tools = match tool_repo.find_by_profile_id(&active_id) {
            Ok(t) => t,
            Err(_) => return vec![],
        };
        let visible_tools: Vec<_> = match visible_server_ids {
            Some(ids) => profile_tools
                .into_iter()
                .filter(|t| ids.contains(&t.server_id))
                .collect(),
            None => profile_tools,
        };

        let mut counts = std::collections::HashMap::new();
        let mut server_names = std::collections::HashMap::new();
        for tool in &visible_tools {
            *counts.entry(tool.tool_name.clone()).or_insert(0u32) += 1;
            server_names
                .entry(tool.server_id.clone())
                .or_insert_with(|| tool.server_name.clone());
        }

        let disabled = tool_repo
            .find_disabled_tools_for_server(Some(&active_id), server_id)
            .unwrap_or_default();
        let discovered = match tool_repo.find_by_server_id(server_id) {
            Ok(tools) => tools,
            Err(_) => return vec![],
        };

        discovered
            .into_iter()
            .map(|tool| {
                let duplicate = counts.get(&tool.tool_name).copied().unwrap_or(0) > 1;
                let is_disabled = disabled.contains(&tool.tool_name);
                let exposed_name = if duplicate {
                    let server_slug = server_names
                        .get(server_id)
                        .map(|name| normalize_server_name(name))
                        .unwrap_or_else(|| "server".to_string());
                    format!("{server_slug}__{}", tool.tool_name)
                } else {
                    tool.tool_name.clone()
                };
                ToolDetail {
                    tool_name: tool.tool_name,
                    exposed_name,
                    description: tool.description,
                    input_schema: tool.input_schema,
                    disabled: is_disabled,
                }
            })
            .collect()
    }
}

fn normalize_server_name(name: &str) -> String {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let slug = slug.trim_matches('_');
    if slug.is_empty() {
        "server".to_string()
    } else {
        slug.to_string()
    }
}
