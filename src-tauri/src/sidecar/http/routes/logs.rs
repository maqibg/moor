use crate::sidecar::db::audit_log_repo::AuditLogRepository;
use crate::sidecar::http::{internal_error, ApiErrorResponse, AppState};
use axum::{
    extract::{Query, State},
    response::Json,
    routing::get,
    Router,
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/logs", get(list))
        .route("/api/logs/stats", get(stats))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogQuery {
    server_id: Option<String>,
    tool_name: Option<String>,
    from: Option<String>,
    to: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

async fn list(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LogQuery>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = AuditLogRepository::new(&state.db);
    let logs = repo
        .query_logs(
            query.server_id.as_deref(),
            query.tool_name.as_deref(),
            query.from.as_deref(),
            query.to.as_deref(),
            query.limit,
            query.offset,
        )
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    Ok(Json(serde_json::to_value(logs).unwrap()))
}

async fn stats(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = AuditLogRepository::new(&state.db);
    let stats = repo
        .get_stats()
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    Ok(Json(serde_json::to_value(stats).unwrap()))
}

fn api_error(_code: &str, message: &str) -> ApiErrorResponse {
    internal_error(message.to_string())
}
