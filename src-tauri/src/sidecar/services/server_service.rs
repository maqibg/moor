use crate::sidecar::db::profile_repo::ProfileRepository;
use crate::sidecar::db::server_repo::{Server, ServerRepository};
use crate::sidecar::db::Database;
use crate::sidecar::services::server_manager::ServerManager;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub struct CreateServerInput {
    pub name: String,
    pub connection_type: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub url: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub headers: Option<HashMap<String, String>>,
    pub working_dir: Option<String>,
    pub auto_start: bool,
}

impl CreateServerInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.is_empty() {
            return Err("name is required".into());
        }
        match self.connection_type.as_str() {
            "stdio" if self.command.as_ref().is_none_or(|c| c.is_empty()) => {
                return Err("command is required for stdio".into());
            }
            "http" if self.url.as_ref().is_none_or(|u| u.is_empty()) => {
                return Err("url is required for http".into());
            }
            "stdio" | "http" => {}
            _ => return Err("connectionType must be 'stdio' or 'http'".into()),
        }
        Ok(())
    }
}

pub struct ServerService;

pub enum ServerServiceError {
    NotFound(String),
    InvalidOrder(String),
    Internal(String),
}

impl ServerService {
    pub async fn insert_server(
        db: &Database,
        server_manager: &Arc<ServerManager>,
        input: &CreateServerInput,
    ) -> Result<Server, String> {
        let server = {
            let repo = ServerRepository::new(db);
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let sort_order = repo.next_top_sort_order()?;

            let args_json = input
                .args
                .as_ref()
                .map(|a| serde_json::to_string(a).unwrap_or_else(|_| "[]".into()));
            let env_json = input
                .env
                .as_ref()
                .map(|e| serde_json::to_string(e).unwrap_or_else(|_| "{}".into()));
            let headers_json = input
                .headers
                .as_ref()
                .map(|h| serde_json::to_string(h).unwrap_or_default());

            repo.insert(
                &id,
                &input.name,
                &input.connection_type,
                input.command.as_deref(),
                args_json.as_deref(),
                input.url.as_deref(),
                env_json.as_deref(),
                headers_json.as_deref(),
                input.working_dir.as_deref(),
                input.auto_start,
                sort_order,
                &now,
                &now,
            )?;

            repo.find_by_id(&id)?
                .ok_or_else(|| "Created server could not be reloaded".to_string())
        }?;

        server_manager.add_server(&server).await;

        Ok(server)
    }

    pub fn list_servers(db: &Database) -> Result<Vec<Server>, String> {
        ServerRepository::new(db).find_all()
    }

    pub fn get_server(db: &Database, id: &str) -> Result<Option<Server>, String> {
        ServerRepository::new(db).find_by_id(id)
    }

    pub async fn update_server(
        db: &Database,
        server_manager: &Arc<ServerManager>,
        id: &str,
        body: &HashMap<String, serde_json::Value>,
    ) -> Result<Server, ServerServiceError> {
        let (new_name, new_auto_start) = {
            let repo = ServerRepository::new(db);
            repo.find_by_id(id)
                .map_err(ServerServiceError::Internal)?
                .ok_or_else(|| ServerServiceError::NotFound("Server not found".into()))?;

            let mut set_clauses = Vec::new();
            let mut param_idx = 1u32;
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            let mut new_name: Option<String> = None;
            let mut new_auto_start: Option<bool> = None;

            if let Some(v) = body.get("name") {
                if let Some(s) = v.as_str() {
                    set_clauses.push(format!("name = ?{param_idx}"));
                    params.push(Box::new(s.to_string()));
                    new_name = Some(s.to_string());
                    param_idx += 1;
                }
            }
            if let Some(v) = body.get("command") {
                set_clauses.push(format!("command = ?{param_idx}"));
                params.push(Box::new(v.as_str().map(|s| s.to_string())));
                param_idx += 1;
            }
            if let Some(v) = body.get("args") {
                set_clauses.push(format!("args = ?{param_idx}"));
                params.push(Box::new(serde_json::to_string(v).unwrap_or_default()));
                param_idx += 1;
            }
            if let Some(v) = body.get("url") {
                set_clauses.push(format!("url = ?{param_idx}"));
                params.push(Box::new(v.as_str().map(|s| s.to_string())));
                param_idx += 1;
            }
            if let Some(v) = body.get("env") {
                set_clauses.push(format!("env = ?{param_idx}"));
                params.push(Box::new(serde_json::to_string(v).unwrap_or_default()));
                param_idx += 1;
            }
            if let Some(v) = body.get("headers") {
                set_clauses.push(format!("headers = ?{param_idx}"));
                params.push(Box::new(serde_json::to_string(v).unwrap_or_default()));
                param_idx += 1;
            }
            if let Some(v) = body.get("workingDir") {
                set_clauses.push(format!("working_dir = ?{param_idx}"));
                params.push(Box::new(v.as_str().map(|s| s.to_string())));
                param_idx += 1;
            }
            if let Some(v) = body.get("autoStart") {
                let val = v.as_bool().unwrap_or(false);
                set_clauses.push(format!("auto_start = ?{param_idx}"));
                params.push(Box::new(val as i64));
                new_auto_start = Some(val);
                param_idx += 1;
            }

            let now = chrono::Utc::now().to_rfc3339();
            set_clauses.push(format!("updated_at = ?{param_idx}"));
            params.push(Box::new(now));

            if !set_clauses.is_empty() {
                let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                    params.iter().map(|p| p.as_ref()).collect();
                repo.update(id, &set_clauses.join(", "), &param_refs)
                    .map_err(ServerServiceError::Internal)?;
            }

            (new_name, new_auto_start)
        };

        server_manager
            .update_server_memory(id, new_name.as_deref(), new_auto_start)
            .await;

        ServerRepository::new(db)
            .find_by_id(id)
            .map_err(ServerServiceError::Internal)?
            .ok_or_else(|| {
                ServerServiceError::Internal("Updated server could not be reloaded".into())
            })
    }

    pub async fn delete_server(
        db: &Database,
        server_manager: &Arc<ServerManager>,
        id: &str,
    ) -> Result<(), ServerServiceError> {
        ServerRepository::new(db)
            .find_by_id(id)
            .map_err(ServerServiceError::Internal)?
            .ok_or_else(|| ServerServiceError::NotFound("Server not found".into()))?;
        if !server_manager.remove_server(id).await {
            return Err(ServerServiceError::Internal(
                "Failed to delete server".into(),
            ));
        }
        Ok(())
    }

    pub fn assign_to_active_profile(db: &Database, server_ids: &[String]) -> Result<(), String> {
        if server_ids.is_empty() {
            return Ok(());
        }
        ProfileRepository::new(db).assign_to_active_profile(server_ids)
    }

    pub fn find_all_names(db: &Database) -> HashSet<String> {
        ServerRepository::new(db)
            .find_all_names()
            .map(|rows| rows.into_iter().map(|(_, name)| name).collect())
            .unwrap_or_default()
    }

    pub fn reorder(
        db: &Database,
        server_ids: &[String],
    ) -> Result<Vec<Server>, ServerServiceError> {
        let repo = ServerRepository::new(db);
        let existing_ids = repo.find_ids().map_err(ServerServiceError::Internal)?;
        let existing_set: HashSet<_> = existing_ids.iter().collect();
        let new_set: HashSet<_> = server_ids.iter().collect();
        if existing_set != new_set {
            return Err(ServerServiceError::InvalidOrder(
                "Server order must include every existing server exactly once.".into(),
            ));
        }
        repo.reorder(server_ids)
            .map_err(ServerServiceError::Internal)?;
        repo.find_all().map_err(ServerServiceError::Internal)
    }
}
