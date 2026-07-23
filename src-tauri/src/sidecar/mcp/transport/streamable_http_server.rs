use crate::sidecar::{
    http::AppState,
    mcp::{jsonrpc, server},
};
use axum::{
    extract::State,
    http::{header, HeaderMap, Method, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use std::{convert::Infallible, sync::Arc, time::Duration};
use tokio_stream::{wrappers::BroadcastStream, StreamExt};

const MCP_SESSION_ID_HEADER: &str = "mcp-session-id";
const MCP_PROTOCOL_VERSION_HEADER: &str = "mcp-protocol-version";
const MAX_REQUEST_BODY_BYTES: usize = 1024 * 1024;

/// Handle incoming MCP Streamable HTTP requests at `/mcp`.
/// POST carries JSON-RPC messages, GET opens the server event stream, and
/// DELETE explicitly terminates a negotiated session.
pub async fn handle_mcp_request(
    State(state): State<Arc<AppState>>,
    req: axum::extract::Request,
) -> Response {
    match *req.method() {
        Method::GET => handle_mcp_get(state, req.headers()).await,
        Method::POST => handle_mcp_post(state, req).await,
        Method::DELETE => handle_mcp_delete(state, req.headers()).await,
        _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
    }
}

async fn handle_mcp_get(state: Arc<AppState>, headers: &HeaderMap) -> Response {
    let accept = match header_value(headers, header::ACCEPT.as_str()) {
        Ok(value) => value.unwrap_or_default(),
        Err(response) => return response,
    };
    if !accept.contains("text/event-stream") {
        return transport_error(
            StatusCode::NOT_ACCEPTABLE,
            "GET requires Accept: text/event-stream",
        );
    }

    let session_id = match header_value(headers, MCP_SESSION_ID_HEADER) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let receiver = if let Some(session_id) = session_id {
        let Some(session) = state.mcp_sessions.get(session_id).await else {
            return transport_error(StatusCode::NOT_FOUND, "Unknown or expired MCP session");
        };
        if let Err(response) = validate_protocol_header(headers, Some(&session.protocol_version)) {
            return response;
        }
        match state.mcp_sessions.subscribe(session_id).await {
            Some(receiver) => receiver,
            None => {
                return transport_error(StatusCode::NOT_FOUND, "Unknown or expired MCP session")
            }
        }
    } else {
        if let Err(response) = validate_protocol_header(headers, None) {
            return response;
        }
        // Session-less GET remains available for older clients that implement
        // Streamable HTTP but ignore optional session negotiation.
        state.mcp_sessions.subscribe_global()
    };

    let stream = BroadcastStream::new(receiver).filter_map(|message| match message {
        Ok(message) => Some(Ok::<Event, Infallible>(
            Event::default().event("message").data(message.to_string()),
        )),
        Err(_) => Some(Ok::<Event, Infallible>(
            Event::default().event("message").data(
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "notifications/tools/list_changed"
                })
                .to_string(),
            ),
        )),
    });

    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(30))
                .text("keep-alive"),
        )
        .into_response()
}

async fn handle_mcp_delete(state: Arc<AppState>, headers: &HeaderMap) -> Response {
    let session_id = match header_value(headers, MCP_SESSION_ID_HEADER) {
        Ok(Some(value)) => value,
        Ok(None) => {
            return transport_error(StatusCode::BAD_REQUEST, "Missing MCP-Session-Id header")
        }
        Err(response) => return response,
    };
    let Some(session) = state.mcp_sessions.get(session_id).await else {
        return transport_error(StatusCode::NOT_FOUND, "Unknown or expired MCP session");
    };
    if let Err(response) = validate_protocol_header(headers, Some(&session.protocol_version)) {
        return response;
    }

    if state.mcp_sessions.remove(session_id).await {
        StatusCode::OK.into_response()
    } else {
        transport_error(StatusCode::NOT_FOUND, "Unknown or expired MCP session")
    }
}

async fn handle_mcp_post(state: Arc<AppState>, req: axum::extract::Request) -> Response {
    let headers = req.headers().clone();
    let agent_info = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let accepts_sse = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/event-stream"));

    let body_bytes = match axum::body::to_bytes(req.into_body(), MAX_REQUEST_BODY_BYTES).await {
        Ok(bytes) if !bytes.is_empty() => bytes,
        Ok(_) => {
            return transport_error_with_code(
                StatusCode::BAD_REQUEST,
                jsonrpc::PARSE_ERROR,
                "Invalid JSON-RPC",
            )
        }
        Err(_) => return transport_error(StatusCode::PAYLOAD_TOO_LARGE, "Request body too large"),
    };
    let raw_message: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(value) => value,
        Err(_) => {
            return transport_error_with_code(
                StatusCode::BAD_REQUEST,
                jsonrpc::PARSE_ERROR,
                "Invalid JSON-RPC",
            )
        }
    };
    if raw_message.get("jsonrpc").and_then(|value| value.as_str()) != Some("2.0") {
        return transport_error(StatusCode::BAD_REQUEST, "Invalid JSON-RPC request");
    }
    let Some(method) = raw_message.get("method").and_then(|value| value.as_str()) else {
        return transport_error(StatusCode::BAD_REQUEST, "Missing JSON-RPC method");
    };

    if let Err(response) = validate_post_context(&state, &headers, method).await {
        return response;
    }
    if raw_message.get("id").is_none() {
        return StatusCode::ACCEPTED.into_response();
    }

    let Some((id, method, params)) = jsonrpc::parse_request_value(&raw_message) else {
        return transport_error(StatusCode::BAD_REQUEST, "Invalid JSON-RPC request");
    };
    let negotiated_version =
        (method == "initialize").then(|| server::negotiated_protocol_version(params.as_ref()));
    let response = server::handle_request(
        id,
        &method,
        params.clone(),
        state.clone(),
        agent_info.as_deref(),
    )
    .await;

    let session_id = match negotiated_version {
        Some(version) if server::protocol_uses_sessions(version) => {
            Some(state.mcp_sessions.create(version).await)
        }
        _ => None,
    };

    build_post_response(response, accepts_sse, session_id.as_deref())
}

async fn validate_post_context(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: &str,
) -> Result<(), Response> {
    let session_id = header_value(headers, MCP_SESSION_ID_HEADER)?;
    if method == "initialize" {
        if session_id.is_some() {
            return Err(transport_error(
                StatusCode::BAD_REQUEST,
                "Initialize must not include MCP-Session-Id",
            ));
        }
        return validate_protocol_header(headers, None);
    }

    match session_id {
        Some(session_id) => {
            let Some(session) = state.mcp_sessions.get(session_id).await else {
                return Err(transport_error(
                    StatusCode::NOT_FOUND,
                    "Unknown or expired MCP session",
                ));
            };
            validate_protocol_header(headers, Some(&session.protocol_version))
        }
        None => {
            validate_protocol_header(headers, None)?;
            let protocol_version = header_value(headers, MCP_PROTOCOL_VERSION_HEADER)?;
            if protocol_version.is_some_and(server::protocol_uses_sessions) {
                return Err(transport_error(
                    StatusCode::BAD_REQUEST,
                    "Missing MCP-Session-Id header",
                ));
            }
            Ok(())
        }
    }
}

fn validate_protocol_header(
    headers: &HeaderMap,
    negotiated_version: Option<&str>,
) -> Result<(), Response> {
    let Some(protocol_version) = header_value(headers, MCP_PROTOCOL_VERSION_HEADER)? else {
        return Ok(());
    };
    if !server::is_supported_protocol_version(protocol_version) {
        return Err(transport_error(
            StatusCode::BAD_REQUEST,
            "Unsupported MCP-Protocol-Version",
        ));
    }
    if negotiated_version.is_some_and(|negotiated| negotiated != protocol_version) {
        return Err(transport_error(
            StatusCode::BAD_REQUEST,
            "MCP-Protocol-Version does not match the negotiated session version",
        ));
    }
    Ok(())
}

fn header_value<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a str>, Response> {
    headers
        .get(name)
        .map(|value| {
            value.to_str().map_err(|_| {
                transport_error(StatusCode::BAD_REQUEST, &format!("Invalid {name} header"))
            })
        })
        .transpose()
}

fn build_post_response(
    response: serde_json::Value,
    accepts_sse: bool,
    session_id: Option<&str>,
) -> Response {
    let mut response = if accepts_sse {
        let body = format!("event: message\ndata: {response}\n\n");
        (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "text/event-stream"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            body,
        )
            .into_response()
    } else {
        (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            response.to_string(),
        )
            .into_response()
    };

    if let Some(session_id) = session_id {
        response.headers_mut().insert(
            MCP_SESSION_ID_HEADER,
            session_id
                .parse()
                .expect("generated session IDs must be valid header values"),
        );
    }
    response
}

fn transport_error(status: StatusCode, message: &str) -> Response {
    transport_error_with_code(status, jsonrpc::INVALID_REQUEST, message)
}

fn transport_error_with_code(status: StatusCode, code: i64, message: &str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": null,
            "error": {
                "code": code,
                "message": message,
            }
        })
        .to_string(),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, routing::any, Router};
    use std::time::SystemTime;
    use tower::ServiceExt;

    fn temp_data_dir(test_name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moor-mcp-http-{test_name}-{timestamp}"))
    }

    fn test_app(test_name: &str) -> (Router, std::path::PathBuf) {
        let data_dir = temp_data_dir(test_name);
        let app = Router::new()
            .route("/mcp", any(handle_mcp_request))
            .with_state(AppState::for_test(&data_dir));
        (app, data_dir)
    }

    fn initialize_request(protocol_version: &str) -> Request<Body> {
        Request::builder()
            .method(Method::POST)
            .uri("/mcp")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::ACCEPT, "application/json")
            .body(Body::from(
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": protocol_version,
                        "capabilities": {},
                        "clientInfo": { "name": "test", "version": "1.0" }
                    }
                })
                .to_string(),
            ))
            .expect("request should build")
    }

    #[tokio::test]
    async fn modern_initialize_creates_session_and_negotiates_version() {
        let (app, data_dir) = test_app("initialize");
        let response = app
            .oneshot(initialize_request("2025-11-25"))
            .await
            .expect("initialize should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().contains_key(MCP_SESSION_ID_HEADER));
        let body = axum::body::to_bytes(response.into_body(), MAX_REQUEST_BODY_BYTES)
            .await
            .expect("response body should be readable");
        let body: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be JSON");
        assert_eq!(body["result"]["protocolVersion"], "2025-11-25");
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn legacy_initialize_remains_sessionless() {
        let (app, data_dir) = test_app("legacy");
        let response = app
            .oneshot(initialize_request(server::LEGACY_PROTOCOL_VERSION))
            .await
            .expect("initialize should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        assert!(!response.headers().contains_key(MCP_SESSION_ID_HEADER));
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn modern_request_requires_negotiated_session() {
        let (app, data_dir) = test_app("missing-session");
        let request = Request::builder()
            .method(Method::POST)
            .uri("/mcp")
            .header(MCP_PROTOCOL_VERSION_HEADER, "2025-11-25")
            .body(Body::from(
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/list"
                })
                .to_string(),
            ))
            .expect("request should build");

        let response = app.oneshot(request).await.expect("request should complete");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn modern_notification_validates_and_uses_negotiated_session() {
        let (app, data_dir) = test_app("session-notification");
        let initialize = app
            .clone()
            .oneshot(initialize_request("2025-06-18"))
            .await
            .expect("initialize should succeed");
        let session_id = initialize
            .headers()
            .get(MCP_SESSION_ID_HEADER)
            .expect("session header should exist")
            .to_str()
            .expect("session header should be text")
            .to_string();
        let notification_body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        })
        .to_string();

        let accepted = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/mcp")
                    .header(MCP_SESSION_ID_HEADER, &session_id)
                    .header(MCP_PROTOCOL_VERSION_HEADER, "2025-06-18")
                    .body(Body::from(notification_body.clone()))
                    .expect("request should build"),
            )
            .await
            .expect("notification should complete");
        assert_eq!(accepted.status(), StatusCode::ACCEPTED);

        let mismatch = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/mcp")
                    .header(MCP_SESSION_ID_HEADER, session_id)
                    .header(MCP_PROTOCOL_VERSION_HEADER, "2025-11-25")
                    .body(Body::from(notification_body))
                    .expect("request should build"),
            )
            .await
            .expect("notification should complete");
        assert_eq!(mismatch.status(), StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn session_get_and_delete_follow_streamable_http_contract() {
        let (app, data_dir) = test_app("session-flow");
        let initialize = app
            .clone()
            .oneshot(initialize_request("2025-11-25"))
            .await
            .expect("initialize should succeed");
        let session_id = initialize
            .headers()
            .get(MCP_SESSION_ID_HEADER)
            .expect("session header should exist")
            .to_str()
            .expect("session header should be text")
            .to_string();

        let get_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/mcp")
                    .header(header::ACCEPT, "text/event-stream")
                    .header(MCP_SESSION_ID_HEADER, &session_id)
                    .header(MCP_PROTOCOL_VERSION_HEADER, "2025-11-25")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("GET should succeed");
        assert_eq!(get_response.status(), StatusCode::OK);
        assert!(get_response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("text/event-stream")));

        let delete_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::DELETE)
                    .uri("/mcp")
                    .header(MCP_SESSION_ID_HEADER, &session_id)
                    .header(MCP_PROTOCOL_VERSION_HEADER, "2025-11-25")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("DELETE should succeed");
        assert_eq!(delete_response.status(), StatusCode::OK);

        let expired_get = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/mcp")
                    .header(header::ACCEPT, "text/event-stream")
                    .header(MCP_SESSION_ID_HEADER, session_id)
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("GET should complete");
        assert_eq!(expired_get.status(), StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn get_stream_delivers_tool_catalog_change_notification() {
        let data_dir = temp_data_dir("catalog-notification");
        let state = AppState::for_test(&data_dir);
        let bridge = tokio::spawn(
            crate::sidecar::mcp::transport::mcp_session::forward_tool_list_changes(
                state.event_bus.subscribe(),
                state.mcp_sessions.clone(),
            ),
        );
        let app = Router::new()
            .route("/mcp", any(handle_mcp_request))
            .with_state(state.clone());
        let initialize = app
            .clone()
            .oneshot(initialize_request("2025-11-25"))
            .await
            .expect("initialize should succeed");
        let session_id = initialize
            .headers()
            .get(MCP_SESSION_ID_HEADER)
            .expect("session header should exist")
            .to_str()
            .expect("session header should be text")
            .to_string();
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/mcp")
                    .header(header::ACCEPT, "text/event-stream")
                    .header(MCP_SESSION_ID_HEADER, session_id)
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("GET should succeed");
        let mut stream = response.into_body().into_data_stream();

        state
            .event_bus
            .emit(crate::sidecar::services::event_bus::Evt::ProfileActivated {
                profile_id: "profile-b".to_string(),
            });
        let chunk = tokio::time::timeout(Duration::from_secs(1), stream.next())
            .await
            .expect("SSE notification should arrive")
            .expect("SSE stream should remain open")
            .expect("SSE chunk should be readable");
        assert!(String::from_utf8_lossy(&chunk).contains("notifications/tools/list_changed"));

        bridge.abort();
        drop(state);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn get_requires_sse_accept_header() {
        let (app, data_dir) = test_app("get-accept");
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/mcp")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("GET should complete");

        assert_eq!(response.status(), StatusCode::NOT_ACCEPTABLE);
        let _ = std::fs::remove_dir_all(data_dir);
    }
}
