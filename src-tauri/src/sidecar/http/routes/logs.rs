use crate::sidecar::db::audit_log_repo::{normalize_time_window, AuditLogRepository};
use crate::sidecar::http::app_error::AppError;
use crate::sidecar::http::AppState;
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
        .route("/api/logs/insights", get(insights))
        .route("/api/logs/stats", get(stats))
}

#[derive(Deserialize)]
struct LogQuery {
    server_id: Option<String>,
    tool_name: Option<String>,
    from: Option<String>,
    to: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(Deserialize)]
struct InsightsQuery {
    from: Option<String>,
    to: Option<String>,
}

async fn list(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LogQuery>,
) -> Result<Json<Value>, AppError> {
    let (from, to) = normalize_time_window(query.from.as_deref(), query.to.as_deref())
        .map_err(AppError::validation)?;
    let db = state.db.clone();
    let value = tokio::task::spawn_blocking(move || {
        let repo = AuditLogRepository::new(&db);
        let logs = repo.query_logs(
            query.server_id.as_deref(),
            query.tool_name.as_deref(),
            from.as_deref(),
            to.as_deref(),
            query.limit,
            query.offset,
        )?;
        serde_json::to_value(logs).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| AppError::internal(format!("Audit log query task failed: {error}")))?
    .map_err(AppError::internal)?;
    Ok(Json(value))
}

async fn insights(
    State(state): State<Arc<AppState>>,
    Query(query): Query<InsightsQuery>,
) -> Result<Json<Value>, AppError> {
    let (from, to) = normalize_time_window(query.from.as_deref(), query.to.as_deref())
        .map_err(AppError::validation)?;
    let db = state.db.clone();
    let value = tokio::task::spawn_blocking(move || {
        let insights = AuditLogRepository::new(&db).get_insights(from.as_deref(), to.as_deref())?;
        serde_json::to_value(insights).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| AppError::internal(format!("Audit insights task failed: {error}")))?
    .map_err(AppError::internal)?;
    Ok(Json(value))
}

async fn stats(State(state): State<Arc<AppState>>) -> Result<Json<Value>, AppError> {
    let db = state.db.clone();
    let value = tokio::task::spawn_blocking(move || {
        let stats = AuditLogRepository::new(&db).get_stats()?;
        serde_json::to_value(stats).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| AppError::internal(format!("Audit stats task failed: {error}")))?
    .map_err(AppError::internal)?;
    Ok(Json(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::db::audit_log_repo::AuditLogRepository;
    use crate::sidecar::db::server_repo::ServerRepository;
    use crate::sidecar::db::Database;
    use axum::body::{to_bytes, Body};
    use std::sync::Arc;
    use std::time::SystemTime;
    use tower::ServiceExt;

    fn temp_data_dir(test_name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moor-logs-route-{test_name}-{timestamp}"))
    }

    fn test_state(data_dir: std::path::PathBuf) -> Arc<AppState> {
        AppState::for_test(&data_dir)
    }

    fn insert_server(db: &Database, id: &str, name: &str) {
        use crate::sidecar::db::server_repo::ServerInsertInput;
        ServerRepository::new(db)
            .insert_one_with_id(
                id,
                0,
                &ServerInsertInput {
                    name: name.into(),
                    connection_type: "stdio".into(),
                    command: Some("node".into()),
                    args: Some(vec![]),
                    url: None,
                    env: None,
                    headers: None,
                    working_dir: None,
                    auto_start: false,
                },
            )
            .expect("failed to insert server");
    }

    #[tokio::test]
    async fn stats_handles_empty_audit_log_table() {
        let data_dir = temp_data_dir("empty-stats");
        let state = test_state(data_dir.clone());

        let Json(value) = stats(State(state)).await.expect("stats should succeed");

        assert_eq!(value["totalCalls"], 0);
        assert_eq!(value["errorCalls"], 0);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn list_accepts_snake_case_frontend_filters() {
        let data_dir = temp_data_dir("snake-case-filters");
        let state = test_state(data_dir.clone());
        insert_server(&state.db, "server-a", "Alpha");
        insert_server(&state.db, "server-b", "Beta");
        let repo = AuditLogRepository::new(&state.db);
        repo.insert(
            "log-a",
            "2026-01-01T00:00:00Z",
            None,
            Some("server-a"),
            "search",
            None,
            None,
            None,
            10,
            None,
        )
        .expect("failed to insert first log");
        repo.insert(
            "log-b",
            "2026-01-01T00:00:01Z",
            None,
            Some("server-b"),
            "search",
            None,
            None,
            None,
            10,
            None,
        )
        .expect("failed to insert second log");

        let response = router()
            .with_state(state)
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/logs?server_id=server-a")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("route should respond");
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("response body should read");
        let logs: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be json");

        assert_eq!(logs.as_array().expect("logs should be array").len(), 1);
        assert_eq!(logs[0]["serverId"], "server-a");
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn list_validates_and_uses_half_open_windows() {
        let data_dir = temp_data_dir("time-windows");
        let state = test_state(data_dir.clone());
        let repo = AuditLogRepository::new(&state.db);
        for (id, timestamp) in [
            ("from", "2026-01-01T00:00:01+00:00"),
            ("to", "2026-01-01T00:00:02Z"),
        ] {
            repo.insert(
                id, timestamp, None, None, "search", None, None, None, 10, None,
            )
            .expect("failed to insert log");
        }
        let app = router().with_state(state);

        for query in [
            "from=garbage",
            "to=garbage",
            "from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z",
        ] {
            let response = app
                .clone()
                .oneshot(
                    axum::http::Request::builder()
                        .uri(format!("/api/logs?{query}"))
                        .body(Body::empty())
                        .expect("request should build"),
                )
                .await
                .expect("route should respond");
            assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
        }

        for (to, expected) in [("2026-01-01T00:00:02Z", 1), ("2026-01-01T00:00:01Z", 0)] {
            let response = app
                .clone()
                .oneshot(
                    axum::http::Request::builder()
                        .uri(format!("/api/logs?from=2026-01-01T00:00:01Z&to={to}"))
                        .body(Body::empty())
                        .expect("request should build"),
                )
                .await
                .expect("route should respond");
            assert_eq!(response.status(), axum::http::StatusCode::OK);
            let body = to_bytes(response.into_body(), 1024 * 1024)
                .await
                .expect("response body should read");
            let logs: serde_json::Value =
                serde_json::from_slice(&body).expect("response should be json");
            assert_eq!(logs.as_array().expect("logs should be array").len(), expected);
        }
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn insights_aggregates_per_tool_and_server_inside_the_window() {
        let data_dir = temp_data_dir("insights");
        let state = test_state(data_dir.clone());
        insert_server(&state.db, "server-a", "Alpha");
        let repo = AuditLogRepository::new(&state.db);
        for (id, timestamp, duration) in [
            ("call-1", "2026-01-01T00:00:01Z", 10),
            ("call-2", "2026-01-01T00:00:02Z", 30),
            ("call-3", "2026-01-01T00:00:03Z", 20),
        ] {
            repo.insert(
                id,
                timestamp,
                None,
                Some("server-a"),
                "search",
                None,
                None,
                None,
                duration,
                None,
            )
            .expect("failed to insert log");
        }
        repo.insert(
            "outside",
            "2026-02-01T00:00:00Z",
            None,
            Some("server-a"),
            "search",
            None,
            None,
            None,
            999,
            None,
        )
        .expect("failed to insert log");

        let app = router().with_state(state);
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/logs/insights?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("route should respond");
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("response body should read");
        let insights: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be json");

        assert_eq!(insights["totalCalls"], 3);
        assert_eq!(insights["errorCalls"], 0);
        assert_eq!(insights["tools"][0]["toolName"], "search");
        assert_eq!(insights["tools"][0]["serverName"], "Alpha");
        assert_eq!(insights["tools"][0]["callCount"], 3);
        // Nearest-rank over [10, 20, 30]: p50 -> 20, p95 -> 30.
        assert_eq!(insights["tools"][0]["p50Ms"], 20.0);
        assert_eq!(insights["tools"][0]["p95Ms"], 30.0);
        assert_eq!(insights["servers"][0]["serverId"], "server-a");
        assert_eq!(insights["servers"][0]["callCount"], 3);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn insights_rejects_invalid_or_inverted_windows() {
        let data_dir = temp_data_dir("insights-window");
        let state = test_state(data_dir.clone());
        let app = router().with_state(state);
        for query in [
            "from=garbage",
            "from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z",
        ] {
            let response = app
                .clone()
                .oneshot(
                    axum::http::Request::builder()
                        .uri(format!("/api/logs/insights?{query}"))
                        .body(Body::empty())
                        .expect("request should build"),
                )
                .await
                .expect("route should respond");
            assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
        }
        let _ = std::fs::remove_dir_all(data_dir);
    }
}
