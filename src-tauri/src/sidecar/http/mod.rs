mod auth;
pub mod routes;

use crate::sidecar::db::Database;
use crate::sidecar::services::event_bus::EventBus;
use crate::sidecar::services::server_manager::ServerManager;
use axum::{http::StatusCode, middleware, response::IntoResponse, Json, Router};
use serde_json::json;
use std::{path::PathBuf, sync::Arc};
use tokio::net::TcpListener;

pub struct AppState {
    pub db: Arc<Database>,
    pub api_token: String,
    pub version: String,
    pub port: u16,
    pub data_dir: PathBuf,
    pub event_bus: Arc<EventBus>,
    pub server_manager: Arc<ServerManager>,
}

pub type ApiResult<T> = Result<Json<T>, ApiErrorResponse>;

#[derive(Debug, Clone)]
pub struct ApiErrorResponse {
    status: StatusCode,
    code: String,
    message: String,
}

impl ApiErrorResponse {
    pub fn new(status: StatusCode, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiErrorResponse {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(json!({
                "error": {
                    "code": self.code,
                    "message": self.message,
                }
            })),
        )
            .into_response()
    }
}

pub fn api_error(
    status: StatusCode,
    code: impl Into<String>,
    message: impl Into<String>,
) -> ApiErrorResponse {
    ApiErrorResponse::new(status, code, message)
}

pub fn validation_error(message: impl Into<String>) -> ApiErrorResponse {
    api_error(StatusCode::BAD_REQUEST, "VALIDATION_ERROR", message)
}

pub fn not_found(message: impl Into<String>) -> ApiErrorResponse {
    api_error(StatusCode::NOT_FOUND, "NOT_FOUND", message)
}

pub fn internal_error(message: impl Into<String>) -> ApiErrorResponse {
    api_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message)
}

pub fn json_error_response(
    status: StatusCode,
    code: impl Into<String>,
    message: impl Into<String>,
) -> axum::response::Response {
    ApiErrorResponse::new(status, code, message).into_response()
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    #[test]
    fn api_errors_use_frontend_compatible_envelope_and_status() {
        let response =
            validation_error("advanced.sidecarPort must be between 1024 and 65535").into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
