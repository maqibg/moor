use crate::sidecar::db::server_repo::ServerRepository;
use crate::sidecar::http::{
    internal_error, not_found, validation_error, ApiErrorResponse, AppState,
};
use axum::{
    extract::{Path, Query, State},
    response::Json,
    routing::{get, post, put},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/servers", get(list).post(create))
        .route("/api/servers/order", put(reorder))
        .route("/api/servers/{id}", get(get_one).put(update).delete(remove))
        .route("/api/servers/{id}/start", post(start))
        .route("/api/servers/{id}/stop", post(stop))
        .route("/api/servers/{id}/tools", get(tools))
}

async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ServerRepository::new(&state.db);
    let servers = repo
        .find_all()
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    Ok(Json(serde_json::to_value(servers).unwrap()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateServerBody {
    name: String,
    connection_type: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    url: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
    headers: Option<std::collections::HashMap<String, String>>,
    working_dir: Option<String>,
    auto_start: Option<bool>,
}

async fn create(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<CreateServerBody>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiErrorResponse> {
    if body.name.is_empty() {
        return Err(api_error("VALIDATION_ERROR", "name is required"));
    }
    match body.connection_type.as_str() {
        "stdio" if body.command.as_ref().is_none_or(|c| c.is_empty()) => {
            return Err(api_error(
                "VALIDATION_ERROR",
                "command is required for stdio",
            ));
        }
        "http" if body.url.as_ref().is_none_or(|u| u.is_empty()) => {
            return Err(api_error("VALIDATION_ERROR", "url is required for http"));
        }
        "stdio" | "http" => {}
        _ => {
            return Err(api_error(
                "VALIDATION_ERROR",
                "connectionType must be 'stdio' or 'http'",
            ))
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let repo = ServerRepository::new(&state.db);
    let sort_order = repo
        .next_top_sort_order()
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;

    let args_json = body
        .args
        .map(|a| serde_json::to_string(&a).unwrap_or_else(|_| "[]".into()));
    let env_json = body
        .env
        .map(|e| serde_json::to_string(&e).unwrap_or_else(|_| "{}".into()));
    let headers_json = body
        .headers
        .map(|h| serde_json::to_string(&h).unwrap_or_default());

    repo.insert(
        &id,
        &body.name,
        &body.connection_type,
        body.command.as_deref(),
        args_json.as_deref(),
        body.url.as_deref(),
        env_json.as_deref(),
        headers_json.as_deref(),
        body.working_dir.as_deref(),
        body.auto_start.unwrap_or(false),
        sort_order,
        &now,
        &now,
    )
    .map_err(|e| api_error("INTERNAL_ERROR", &e))?;

    let server = repo
        .find_by_id(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?
        .ok_or_else(|| api_error("INTERNAL_ERROR", "Created server could not be reloaded"))?;

    // Add to server manager memory
    let managed = state.server_manager.add_server(&server).await;

    // Assign to active profile
    let profile_repo = crate::sidecar::db::profile_repo::ProfileRepository::new(&state.db);
    let _ = profile_repo.assign_to_active_profile(std::slice::from_ref(&id));

    // Auto-start if requested
    if managed.auto_start {
        let sm = state.server_manager.clone();
        let server_id = id.clone();
        tokio::spawn(async move {
            let _ = sm.start_server(&server_id).await;
        });
    }

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::to_value(server).unwrap()),
    ))
}

#[derive(Deserialize)]
struct ReorderBody {
    #[serde(rename = "serverIds")]
    server_ids: Vec<String>,
}

async fn reorder(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<ReorderBody>,
) -> Result<Json<Value>, ApiErrorResponse> {
    if body.server_ids.is_empty() {
        return Err(api_error(
            "ORDER_INVALID",
            "Server order must include every existing server exactly once.",
        ));
    }
    let repo = ServerRepository::new(&state.db);
    let existing_ids = repo
        .find_ids()
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    let existing_set: std::collections::HashSet<_> = existing_ids.iter().collect();
    let new_set: std::collections::HashSet<_> = body.server_ids.iter().collect();
    if existing_set != new_set {
        return Err(api_error(
            "ORDER_INVALID",
            "Server order must include every existing server exactly once.",
        ));
    }
    repo.reorder(&body.server_ids)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    let servers = repo
        .find_all()
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    Ok(Json(serde_json::to_value(servers).unwrap()))
}

async fn get_one(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ServerRepository::new(&state.db);
    let mut server = repo
        .find_by_id(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?
        .ok_or_else(|| api_error("NOT_FOUND", "Server not found"))?;

    // Merge runtime status from server manager
    if let Some(managed) = state.server_manager.get_server(&id).await {
        server.status = managed.status;
    }

    Ok(Json(serde_json::to_value(server).unwrap()))
}

async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<std::collections::HashMap<String, serde_json::Value>>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ServerRepository::new(&state.db);
    let _ = repo
        .find_by_id(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?
        .ok_or_else(|| api_error("NOT_FOUND", "Server not found"))?;

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
        repo.update(&id, &set_clauses.join(", "), &param_refs)
            .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    }

    // Update server manager memory
    let sm = state.server_manager.clone();
    let update_id = id.clone();
    tokio::spawn(async move {
        sm.update_server_memory(&update_id, new_name.as_deref(), new_auto_start)
            .await;
    });

    let server = repo
        .find_by_id(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?
        .ok_or_else(|| api_error("INTERNAL_ERROR", "Updated server could not be reloaded"))?;
    Ok(Json(serde_json::to_value(server).unwrap()))
}

async fn remove(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ServerRepository::new(&state.db);
    let _ = repo
        .find_by_id(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?
        .ok_or_else(|| api_error("NOT_FOUND", "Server not found"))?;

    state.server_manager.remove_server(&id).await;
    Ok(Json(json!({ "success": true })))
}

async fn start(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    state
        .server_manager
        .start_server(&id)
        .await
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    Ok(Json(json!({ "status": "started" })))
}

async fn stop(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    state
        .server_manager
        .stop_server(&id)
        .await
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    Ok(Json(json!({ "status": "stopped" })))
}

#[derive(Deserialize)]
struct ToolsQuery {
    profile_id: Option<String>,
}

async fn tools(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ToolsQuery>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = crate::sidecar::db::tool_discovery_repo::ToolDiscoveryRepository::new(&state.db);
    let mut tools = repo
        .find_by_server_id(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;

    let disabled = repo
        .find_disabled_tools_for_server(query.profile_id.as_deref(), &id)
        .unwrap_or_default();

    tools.retain(|t| !disabled.contains(&t.tool_name));

    Ok(Json(serde_json::to_value(tools).unwrap()))
}

fn api_error(code: &str, message: &str) -> ApiErrorResponse {
    match code {
        "VALIDATION_ERROR" | "ORDER_INVALID" => validation_error(message.to_string()),
        "NOT_FOUND" => not_found(message.to_string()),
        _ => internal_error(message.to_string()),
    }
}
