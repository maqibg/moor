pub mod app_error;
mod auth;
pub mod routes;

use crate::sidecar::db::Database;
use crate::sidecar::services::event_bus::EventBus;
use crate::sidecar::services::server_manager::ServerManager;
use axum::{http::StatusCode, middleware, response::IntoResponse, Json, Router};
use serde_json::json;
use std::sync::Arc;
use tokio::net::TcpListener;

pub struct AppState {
    pub db: Arc<Database>,
    pub api_token: String,
    pub version: String,
    pub port: u16,
    pub event_bus: Arc<EventBus>,
    pub server_manager: Arc<ServerManager>,
}

pub fn create_app(state: Arc<AppState>) -> Router {
    let mcp_routes = Router::new().route(
        "/mcp",
        axum::routing::any(
            crate::sidecar::mcp::transport::streamable_http_server::handle_mcp_request,
        ),
    );

    Router::new()
        .merge(routes::health::router())
        .merge(routes::servers::router())
        .merge(routes::profiles::router())
        .merge(routes::logs::router())
        .merge(routes::settings::router())
        .merge(routes::events::router())
        .merge(routes::import_routes::router())
        .merge(mcp_routes)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::sidecar::http::auth::auth_middleware,
        ))
        .with_state(state)
}

pub fn json_error_response(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> axum::response::Response {
    (
        status,
        Json(json!({ "error": { "code": code, "message": message.into() } })),
    )
        .into_response()
}

pub async fn start_server(state: Arc<AppState>, host: &str, port: u16) -> Result<(), String> {
    let addr = format!("{host}:{port}");
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind {addr}: {e}"))?;
    let app = create_app(state);
    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server error: {e}"))
}
