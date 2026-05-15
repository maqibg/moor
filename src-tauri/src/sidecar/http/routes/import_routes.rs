use crate::sidecar::config::converter::ConvertInput;
use crate::sidecar::config::import_parser::ScannedServer;
use crate::sidecar::config::scanner::{self, ImportPreview};
use crate::sidecar::config::{converter, import_parser, snippets};
use crate::sidecar::db::server_repo::ServerRepository;
use crate::sidecar::http::{internal_error, validation_error, ApiErrorResponse, AppState};
use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/import/scan", post(scan))
        .route("/api/import/parse", post(parse))
        .route("/api/import/execute", post(execute))
        .route("/api/import/snippets", get(snippets_handler))
        .route("/api/import/convert", post(convert))
}

async fn scan(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiErrorResponse> {
    let parsed = scanner::scan_all_configs();
    let existing_names = get_existing_names(&state.db);
    let preview = scanner::build_import_preview(&parsed, &existing_names);
    Ok(Json(serde_json::to_value(preview).unwrap()))
}

#[derive(Deserialize)]
struct ParseBody {
    content: Option<String>,
}

async fn parse(axum::Json(body): axum::Json<ParseBody>) -> Result<Json<Value>, ApiErrorResponse> {
    let content = body.content.unwrap_or_default();
    if content.trim().is_empty() {
        return Err(api_error("VALIDATION_ERROR", "content is required"));
    }
    if content.len() > 512 * 1024 {
        return Err(api_error(
            "PAYLOAD_TOO_LARGE",
            "content exceeds maximum allowed size",
        ));
    }

    let parsed = import_parser::parse_json_mcp_config(&content, "json-import");
    // No existing names check for parse — just return parsed results
    let preview = ImportPreview {
        scanned: parsed.servers.len() + parsed.unsupported.len(),
        new_servers: parsed.servers.len(),
        servers: parsed.servers,
        duplicates: vec![],
        unsupported: parsed.unsupported,
        errors: parsed.errors,
        diagnostics: parsed.diagnostics,
    };
    Ok(Json(serde_json::to_value(preview).unwrap()))
}

#[derive(Deserialize)]
struct ExecuteBody {
    servers: Option<Vec<ScannedServer>>,
}

async fn execute(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<ExecuteBody>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let existing_names = get_existing_names(&state.db);
    let all_servers = match body.servers {
        Some(s) if !s.is_empty() => s,
        _ => scanner::scan_all_configs().servers,
    };
    let (candidates, skipped) = scanner::partition_import_candidates(&all_servers, &existing_names);
    let mut imported = vec![];
    let mut imported_ids = vec![];

    for server_config in &candidates {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let repo = ServerRepository::new(&state.db);
        let sort_order = repo
            .next_top_sort_order()
            .map_err(|e| api_error("INTERNAL_ERROR", &e))?;

        let args_json = server_config
            .args
            .as_ref()
            .map(|a| serde_json::to_string(a).unwrap_or_else(|_| "[]".into()));
        let env_json = server_config
            .env
            .as_ref()
            .map(|e| serde_json::to_string(e).unwrap_or_else(|_| "{}".into()));
        let headers_json = server_config
            .headers
            .as_ref()
            .map(|h| serde_json::to_string(h).unwrap_or_default());

        repo.insert(
            &id,
            &server_config.name,
            &server_config.connection_type,
            server_config.command.as_deref(),
            args_json.as_deref(),
            server_config.url.as_deref(),
            env_json.as_deref(),
            headers_json.as_deref(),
            server_config.working_dir.as_deref(),
            false,
            sort_order,
            &now,
            &now,
        )
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;

        let server = repo
            .find_by_id(&id)
            .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
        if let Some(server) = server {
            state.server_manager.add_server(&server).await;
        }

        imported.push(server_config.name.clone());
        imported_ids.push(id);
    }

    if !imported_ids.is_empty() {
        let profile_repo = crate::sidecar::db::profile_repo::ProfileRepository::new(&state.db);
        let _ = profile_repo.assign_to_active_profile(&imported_ids);
    }

    Ok(Json(json!({ "imported": imported, "skipped": skipped })))
}

async fn snippets_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let base_url = format!("http://127.0.0.1:{}/mcp", state.port);
    let result = snippets::generate_snippets(&base_url);
    Ok(Json(serde_json::to_value(result).unwrap()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvertBody {
    source: Option<String>,
    target_client: Option<String>,
    content: Option<String>,
    source_client: Option<String>,
    server_ids: Option<Vec<String>>,
}

async fn convert(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<ConvertBody>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let target_client = body.target_client.unwrap_or_default();
    let source = body.source.unwrap_or_else(|| "scan".to_string());

    if let Some(ref content) = body.content {
        if content.len() > 512 * 1024 {
            return Err(api_error(
                "PAYLOAD_TOO_LARGE",
                "content exceeds maximum allowed size",
            ));
        }
    }

    if clients::get_client_by_id(&target_client).is_none() {
        return Err(api_error(
            "VALIDATION_ERROR",
            &format!("unknown client id: {target_client}"),
        ));
    }

    let input = ConvertInput {
        source,
        source_client: body.source_client,
        content: body.content,
        server_ids: body.server_ids,
        target_client,
    };

    match converter::convert_config(&input, &state.db) {
        Ok(result) => Ok(Json(serde_json::to_value(result).unwrap())),
        Err(e) => Err(api_error("INTERNAL_ERROR", &e)),
    }
}

fn get_existing_names(db: &crate::sidecar::db::Database) -> std::collections::HashSet<String> {
    let repo = ServerRepository::new(db);
    repo.find_all_names()
        .map(|rows| rows.into_iter().map(|(_, name)| name).collect())
        .unwrap_or_default()
}

fn api_error(code: &str, message: &str) -> ApiErrorResponse {
    match code {
        "VALIDATION_ERROR" => validation_error(message.to_string()),
        "PAYLOAD_TOO_LARGE" => crate::sidecar::http::api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            code,
            message.to_string(),
        ),
        _ => internal_error(message.to_string()),
    }
}

use crate::sidecar::config::clients;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::db::Database;
    use crate::sidecar::services::event_bus::EventBus;
    use crate::sidecar::services::server_manager::ServerManager;
    use std::sync::Arc;
    use std::time::SystemTime;

    fn temp_data_dir(test_name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moor-import-{test_name}-{timestamp}"))
    }

    #[tokio::test]
    async fn snippets_use_runtime_port() {
        let data_dir = temp_data_dir("snippets-port");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp data dir");
        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        let event_bus = Arc::new(EventBus::new(16));
        let state = Arc::new(AppState {
            db: db.clone(),
            api_token: "test-token".to_string(),
            version: "test".to_string(),
            port: 19444,
            event_bus: event_bus.clone(),
            server_manager: Arc::new(ServerManager::new(db, event_bus)),
        });

        let Json(value) = snippets_handler(State(state))
            .await
            .expect("snippets should succeed");
        let snippets = value.as_array().expect("snippets should be an array");
        assert!(snippets.iter().any(|snippet| snippet["snippet"]
            .as_str()
            .unwrap_or("")
            .contains("127.0.0.1:19444")));
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[test]
    fn convert_body_accepts_frontend_camel_case_fields() {
        let body: ConvertBody = serde_json::from_value(serde_json::json!({
            "source": "paste",
            "targetClient": "claude-code",
            "sourceClient": "cursor",
            "serverIds": ["server-a"],
            "content": "{}"
        }))
        .expect("frontend convert payload should deserialize");

        assert_eq!(body.target_client.as_deref(), Some("claude-code"));
        assert_eq!(body.source_client.as_deref(), Some("cursor"));
        assert_eq!(
            body.server_ids.as_deref(),
            Some(&["server-a".to_string()][..])
        );
    }
}
