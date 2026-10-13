use super::AppState;
use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
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

// RFC1918 only — accepted for /mcp when allowLanMcpAccess is on; /api/* stays loopback-only (#60)
fn is_private_host(host: &str) -> bool {
    host.split(':')
        .next()
        .unwrap_or("")
        .parse::<std::net::Ipv4Addr>()
        .is_ok_and(|ip| ip.is_private())
}

/// The private-host exception is gated on the opt-in setting, not on the bind
/// address: a port forward (WSL2 netsh portproxy, ssh -L) can expose a
/// loopback-bound gateway, and the Host header itself is client-controlled.
fn is_allowed_host(host: &str, path: &str, allow_lan_mcp_access: bool) -> bool {
    is_loopback_host(host) || (path == "/mcp" && allow_lan_mcp_access && is_private_host(host))
}

fn lan_mcp_access_enabled(state: &AppState) -> bool {
    // 读内存缓存而不是同步查库：/mcp 是每次工具调用的热路径，且设置写路径会刷新缓存。
    state
        .server_manager
        .settings_cache()
        .snapshot()
        .advanced
        .allow_lan_mcp_access
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

    // Host check — /mcp additionally accepts RFC1918 hosts when LAN access is
    // explicitly enabled (WSL2/LAN, #60).
    let path = req.uri().path();
    let mcp_path = path == "/mcp";
    match headers.get(header::HOST) {
        Some(host) => {
            let host = host.to_str().unwrap_or("");
            // 短路：环回请求直接放行，避免每个本地 /mcp 请求都读一次设置库。
            let allowed = is_loopback_host(host)
                || is_allowed_host(host, path, mcp_path && lan_mcp_access_enabled(&state));
            if !allowed {
                return super::json_error_response(
                    StatusCode::FORBIDDEN,
                    "FORBIDDEN",
                    "Invalid Host header",
                );
            }
        }
        // HTTP/1.1 always carries Host; a missing one on the LAN-exposed MCP
        // endpoint would skip the check entirely, so reject it there.
        None if mcp_path => {
            return super::json_error_response(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "Missing Host header",
            );
        }
        None => {}
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

    // Remove host check headers to avoid passing them to handler
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
    fn recognizes_rfc1918_hosts_only() {
        assert!(is_private_host("10.0.0.5:9223"));
        assert!(is_private_host("172.26.32.1:9223"));
        assert!(is_private_host("192.168.1.10:9223"));
        assert!(!is_private_host("8.8.8.8:9223"));
        assert!(!is_private_host("localhost:9223"));
        assert!(!is_private_host("172.32.0.1:9223"));
    }

    #[test]
    fn private_hosts_need_the_explicit_lan_opt_in() {
        // Loopback is always allowed, regardless of the setting or path.
        assert!(is_allowed_host("127.0.0.1:9223", "/mcp", false));
        assert!(is_allowed_host("127.0.0.1:9223", "/api/servers", false));
        // Private hosts only for /mcp and only when opted in.
        assert!(is_allowed_host("192.168.1.10:9223", "/mcp", true));
        assert!(!is_allowed_host("192.168.1.10:9223", "/mcp", false));
        assert!(!is_allowed_host("192.168.1.10:9223", "/api/servers", true));
        // Public hosts stay rejected even with the opt-in.
        assert!(!is_allowed_host("8.8.8.8:9223", "/mcp", true));
    }
}
