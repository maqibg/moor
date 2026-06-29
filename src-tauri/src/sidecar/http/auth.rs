use super::AppState;
use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use std::net::IpAddr;
use std::sync::Arc;

const ALLOWED_DEV_ORIGINS: &[&str] = &[
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];

fn is_loopback_host(host: &str) -> bool {
    if host == "[::1]" || host.starts_with("[::1]:") {
        return true;
    }
    let hostname = host.split(':').next().unwrap_or("").to_lowercase();
    matches!(hostname.as_str(), "127.0.0.1" | "localhost" | "::1")
}

fn host_ip(host: &str) -> Option<IpAddr> {
    let hostname = host.split(':').next()?.trim();
    let hostname = hostname.trim_start_matches('[').trim_end_matches(']');
    hostname.parse().ok()
}

fn is_private_lan_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_unique_local() || v6.is_loopback(),
    }
}

fn is_private_lan_host(host: &str) -> bool {
    host_ip(host).is_some_and(|ip| is_private_lan_ip(&ip))
}

fn is_allowed_host(host: &str, path: &str, allow_wsl_mcp_access: bool) -> bool {
    if is_loopback_host(host) {
        return true;
    }
    allow_wsl_mcp_access && path == "/mcp" && is_private_lan_host(host)
}

fn is_allowed_origin(origin: &str) -> bool {
    ALLOWED_DEV_ORIGINS.contains(&origin)
}

pub async fn auth_middleware(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Response {
    let headers = req.headers();
    let path = req.uri().path().to_string();

    // Host check
    if let Some(host) = headers.get(header::HOST) {
        if !is_allowed_host(
            host.to_str().unwrap_or(""),
            &path,
            state.allow_wsl_mcp_access,
        ) {
            return super::json_error_response(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "Invalid Host header",
            );
        }
    }

    // Origin check
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(ref origin) = origin {
        if !is_allowed_origin(origin) {
            return super::json_error_response(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "Invalid Origin header",
            );
        }
    }

    // CORS preflight
    if req.method() == "OPTIONS" {
        let mut response = Response::new(axum::body::Body::empty());
        *response.status_mut() = StatusCode::NO_CONTENT;
        if let Some(ref origin) = origin {
            response
                .headers_mut()
                .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.parse().unwrap());
        }
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            "Content-Type, X-Moor-Token, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Method, Mcp-Name"
                .parse()
                .unwrap(),
        );
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            "GET, POST, PUT, PATCH, DELETE, OPTIONS".parse().unwrap(),
        );
        return response;
    }

    // Token check for /api/* paths — before running handler
    if path.starts_with("/api/") {
        let token = headers.get("x-moor-token").and_then(|v| v.to_str().ok());
        match token {
            Some(t) if t == state.api_token => {}
            _ => {
                return super::json_error_response(
                    StatusCode::UNAUTHORIZED,
                    "UNAUTHORIZED",
                    "Unauthorized",
                )
            }
        }
    }

    let response = next.run(req).await;

    // Add CORS headers to response
    let mut response = response;
    if let Some(ref origin) = origin {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.parse().unwrap());
    }
    response
        .headers_mut()
        .insert(header::VARY, "Origin".parse().unwrap());
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_tauri_substring_origins() {
        assert!(!is_allowed_origin("https://evil-tauri.example"));
    }

    #[test]
    fn allows_exact_tauri_and_dev_origins() {
        assert!(is_allowed_origin("tauri://localhost"));
        assert!(is_allowed_origin("http://localhost:1420"));
    }

    #[test]
    fn recognizes_loopback_hosts() {
        assert!(is_loopback_host("127.0.0.1:9223"));
        assert!(is_loopback_host("[::1]:9223"));
        assert!(!is_loopback_host("192.168.1.10:9223"));
    }

    #[test]
    fn allows_private_wsl_host_on_mcp_when_enabled() {
        assert!(is_allowed_host("172.26.32.1:9223", "/mcp", true));
        assert!(!is_allowed_host("172.26.32.1:9223", "/api/health", true));
        assert!(!is_allowed_host("172.26.32.1:9223", "/mcp", false));
    }

    #[test]
    fn rejects_public_host_even_when_wsl_access_enabled() {
        assert!(!is_allowed_host("8.8.8.8:9223", "/mcp", true));
    }
}
