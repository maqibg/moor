use crate::sidecar::http::AppState;
use axum::{extract::State, response::Json, routing::get, Router};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/runtime", get(runtime))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn runtime(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({
        "port": state.port,
        "baseUrl": format!("http://127.0.0.1:{}", state.port),
        "version": state.version,
        "pid": std::process::id(),
        "apiTokenConfigured": !state.api_token.is_empty(),
    }))
}
