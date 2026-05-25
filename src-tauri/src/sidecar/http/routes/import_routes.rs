use crate::sidecar::config::converter::ConvertInput;
use crate::sidecar::config::import_parser::ScannedServer;
use crate::sidecar::config::scanner::{self, ImportPreview};
use crate::sidecar::config::{converter, import_parser, snippets};
use crate::sidecar::http::{error_from_code, internal_error, ApiErrorResponse, AppState};
use crate::sidecar::services::server_service::{CreateServerInput, ServerService};
use axum::{
    extract::State,
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
    let existing_names = ServerService::find_all_names(&state.db);
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
        return Err(error_from_code("VALIDATION_ERROR", "content is required"));
    }
    if content.len() > 512 * 1024 {
        return Err(error_from_code(
            "PAYLOAD_TOO_LARGE",
            "content exceeds maximum allowed size",
        ));
    }

    let parsed = import_parser::parse_json_mcp_config(&content, "json-import");
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
    let existing_names = ServerService::find_all_names(&state.db);
    let all_servers = match body.servers {
        Some(s) if !s.is_empty() => s,
        _ => scanner::scan_all_configs().servers,
    };
    let (candidates, skipped) = scanner::partition_import_candidates(&all_servers, &existing_names);
    let mut imported = vec![];
    let mut imported_ids = vec![];

    for server_config in &candidates {
        let input = CreateServerInput {
            name: server_config.name.clone(),
            connection_type: server_config.connection_type.clone(),
            command: server_config.command.clone(),
            args: server_config.args.clone(),
            url: server_config.url.clone(),
            env: server_config.env.clone(),
            headers: server_config.headers.clone(),
            working_dir: server_config.working_dir.clone(),
            auto_start: false,
        };

        let server = ServerService::insert_server(&state.db, &state.server_manager, &input)
            .await
            .map_err(internal_error)?;

        imported.push(server.name);
        imported_ids.push(server.id);
    }

    if !imported_ids.is_empty() {
        ServerService::assign_to_active_profile(&state.db, &imported_ids)
            .map_err(internal_error)?;
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
            return Err(error_from_code(
                "PAYLOAD_TOO_LARGE",
                "content exceeds maximum allowed size",
            ));
        }
    }

    if clients::get_client_by_id(&target_client).is_none() {
        return Err(error_from_code(
            "VALIDATION_ERROR",
            format!("unknown client id: {target_client}"),
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
        Err(e) => Err(internal_error(e)),
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
