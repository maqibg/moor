use crate::sidecar::db::profile_repo::ProfileRepository;
use crate::sidecar::db::tool_discovery_repo::ToolDiscoveryRepository;
use crate::sidecar::db::Database;

#[derive(Debug, Clone)]
pub struct ToolCatalogEntry {
    pub server_id: String,
    pub server_name: String,
    pub tool_name: String,
    pub exposed_name: String,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
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
