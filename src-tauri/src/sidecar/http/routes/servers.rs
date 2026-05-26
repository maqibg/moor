use crate::sidecar::http::{error_from_code, internal_error, ApiErrorResponse, AppState};
use crate::sidecar::services::server_manager::public_server_start_error_message;
use crate::sidecar::services::server_service::{
    CreateServerInput, ServerService, ServerServiceError, UpdateServerInput,
};
use axum::{
    extract::{Path, Query, State},
    response::Json,
    routing::{get, post, put},
    Router,
};
use serde::Deserialize;
use serde_json::Value;
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
    let servers = ServerService::list_servers(&state.db).map_err(internal_error)?;
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
    let input = CreateServerInput {
        name: body.name,
        connection_type: body.connection_type,
        command: body.command,
        args: body.args,
        url: body.url,
        env: body.env,
        headers: body.headers,
        working_dir: body.working_dir,
        auto_start: body.auto_start.unwrap_or(false),
    };
    input
        .validate()
        .map_err(|e| error_from_code("VALIDATION_ERROR", e))?;

    let server = ServerService::insert_server(&state.db, &state.server_manager, &input)
        .await
        .map_err(internal_error)?;

    if server.auto_start {
        let sm = state.server_manager.clone();
        let server_id = server.id.clone();
        tokio::spawn(async move {
            let _ = sm.start_server(&server_id).await;
        });
    }

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::to_value(&server).unwrap()),
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
        return Err(error_from_code(
            "ORDER_INVALID",
            "Server order must include every existing server exactly once.",
        ));
    }
    let servers =
        ServerService::reorder(&state.db, &body.server_ids).map_err(server_service_error)?;
    Ok(Json(serde_json::to_value(servers).unwrap()))
}

async fn get_one(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let mut server = ServerService::get_server(&state.db, &id)
        .map_err(internal_error)?
        .ok_or_else(|| error_from_code("NOT_FOUND", "Server not found"))?;

    if let Some(managed) = state.server_manager.get_server(&id).await {
        server.status = managed.status;
    }

    Ok(Json(serde_json::to_value(server).unwrap()))
}

async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<UpdateServerInput>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let server = ServerService::update_server(&state.db, &state.server_manager, &id, &body)
        .await
        .map_err(server_service_error)?;
    Ok(Json(serde_json::to_value(server).unwrap()))
}

async fn remove(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    ServerService::delete_server(&state.db, &state.server_manager, &id)
        .await
        .map_err(server_service_error)?;
    Ok(Json(serde_json::json!({ "success": true })))
}

fn server_service_error(error: ServerServiceError) -> ApiErrorResponse {
    match error {
        ServerServiceError::NotFound(message) => error_from_code("NOT_FOUND", message),
        ServerServiceError::Validation(message) => error_from_code("VALIDATION_ERROR", message),
        ServerServiceError::InvalidOrder(message) => error_from_code("ORDER_INVALID", message),
        ServerServiceError::Internal(message) => internal_error(message),
    }
}

async fn start(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    state
        .server_manager
        .start_server(&id)
        .await
        .map_err(|err| internal_error(public_server_start_error_message(&err)))?;
    Ok(Json(serde_json::json!({ "status": "started" })))
}

async fn stop(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    state
        .server_manager
        .stop_server(&id)
        .await
        .map_err(internal_error)?;
    Ok(Json(serde_json::json!({ "status": "stopped" })))
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
    let tools = state
        .server_manager
        .get_tool_details(&id, query.profile_id.as_deref())
        .await;
    Ok(Json(serde_json::to_value(tools).unwrap()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::db::profile_repo::ProfileRepository;
    use crate::sidecar::db::server_repo::ServerRepository;
    use crate::sidecar::db::tool_discovery_repo::{ToolDiscoveryRepository, ToolInsert};
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
        std::env::temp_dir().join(format!("moor-server-route-{test_name}-{timestamp}"))
    }

    fn test_state(data_dir: std::path::PathBuf) -> Arc<AppState> {
        std::fs::create_dir_all(&data_dir).expect("failed to create temp data dir");
        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to run migrations");
        let event_bus = Arc::new(EventBus::new(16));
        Arc::new(AppState {
            db: db.clone(),
            api_token: "test-token".to_string(),
            version: "test".to_string(),
            port: 19323,
            event_bus: event_bus.clone(),
            server_manager: Arc::new(ServerManager::new(db, event_bus)),
        })
    }

    fn insert_server(db: &Database, id: &str, name: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        ServerRepository::new(db)
            .insert(
                id,
                name,
                "stdio",
                Some("node"),
                Some("[]"),
                None,
                None,
                None,
                None,
                false,
                0,
                &now,
                &now,
            )
            .expect("failed to insert server");
    }

    fn fail_profile_server_inserts(db: &Database) {
        db.exec(
            "CREATE TRIGGER fail_profile_server_insert
             BEFORE INSERT ON profile_servers
             BEGIN
               SELECT RAISE(ABORT, 'profile insert failed');
             END;",
        )
        .expect("failed to create failing profile trigger");
    }

    #[tokio::test]
    async fn create_rolls_back_server_when_profile_assignment_fails() {
        let data_dir = temp_data_dir("create-profile-failure");
        let state = test_state(data_dir.clone());
        ProfileRepository::new(&state.db)
            .seed_default()
            .expect("failed to seed profile");
        fail_profile_server_inserts(&state.db);

        let result = create(
            State(state.clone()),
            axum::Json(CreateServerBody {
                name: "Broken".to_string(),
                connection_type: "stdio".to_string(),
                command: Some("node".to_string()),
                args: None,
                url: None,
                env: None,
                headers: None,
                working_dir: None,
                auto_start: None,
            }),
        )
        .await;

        assert!(result.is_err());
        let ids = state
            .db
            .query_all("SELECT id FROM mcp_servers", &[], |row| {
                row.get::<_, String>(0)
            })
            .expect("failed to query servers");
        for id in &ids {
            assert!(state.server_manager.get_server(id).await.is_none());
        }
        assert!(ids.is_empty());

        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn tools_route_returns_disabled_tools_with_callable_exposed_names() {
        let data_dir = temp_data_dir("tools-detail");
        let state = test_state(data_dir.clone());
        let profile_repo = ProfileRepository::new(&state.db);
        profile_repo.seed_default().expect("failed to seed profile");
        let profile_id = profile_repo
            .find_active_id()
            .expect("failed to find active profile")
            .expect("active profile should exist");

        insert_server(&state.db, "server-a", "Alpha");
        insert_server(&state.db, "server-b", "Beta");
        profile_repo
            .assign_to_active_profile(&["server-a".to_string(), "server-b".to_string()])
            .expect("failed to assign profile servers");
        profile_repo
            .upsert_profile_server(
                &profile_id,
                "server-a",
                Some(true),
                Some(&vec!["search".to_string()]),
            )
            .expect("failed to disable tool");

        let discovered_tools = [ToolInsert {
            name: "search".to_string(),
            description: Some("Search".to_string()),
            input_schema: Some(serde_json::json!({"type": "object"})),
        }];
        let tool_repo = ToolDiscoveryRepository::new(&state.db);
        tool_repo
            .replace_tools_for_server("server-a", &discovered_tools)
            .expect("failed to insert tools for server-a");
        tool_repo
            .replace_tools_for_server("server-b", &discovered_tools)
            .expect("failed to insert tools for server-b");

        let Json(value) = tools(
            State(state),
            Path("server-a".to_string()),
            Query(ToolsQuery {
                profile_id: Some(profile_id),
            }),
        )
        .await
        .expect("tools route should succeed");

        let list = value.as_array().expect("tools response should be array");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["toolName"], "search");
        assert_eq!(list[0]["disabled"], true);
        assert_eq!(list[0]["exposedName"], "alpha__search");

        let _ = std::fs::remove_dir_all(data_dir);
    }
}
