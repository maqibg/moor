use crate::sidecar::http::app_error::AppError;
use crate::sidecar::http::AppState;
use crate::sidecar::services::profile_service::ProfileService;
use axum::{
    extract::{Path, State},
    response::Json,
    routing::{get, put},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/profiles", get(list).post(create))
        .route(
            "/api/profiles/{id}",
            get(get_one).put(update).delete(remove),
        )
        .route("/api/profiles/{id}/activate", put(activate))
        .route("/api/profiles/{id}/clone", axum::routing::post(clone))
        .route("/api/profiles/{id}/tools", get(profile_tools))
        .route(
            "/api/profiles/{id}/servers-state",
            put(bulk_upsert_servers),
        )
        .route(
            "/api/profiles/{profileId}/servers/{serverId}",
            get(get_profile_server).put(upsert_profile_server),
        )
}

async fn clone(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<CreateBody>,
) -> Result<(axum::http::StatusCode, Json<Value>), AppError> {
    let profile =
        ProfileService::clone_profile(&state.db, &id, &body.name).map_err(AppError::from)?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::to_value(profile).map_err(|e| AppError::internal(e.to_string()))?),
    ))
}

async fn profile_tools(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let groups = ProfileService::get_profile_tool_groups(&state.db, &id).map_err(AppError::from)?;
    Ok(Json(
        serde_json::to_value(groups).map_err(|e| AppError::internal(e.to_string()))?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BulkServerStateBody {
    updates: Vec<BulkServerStateUpdate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BulkServerStateUpdate {
    server_id: String,
    enabled: Option<bool>,
    disabled_tools: Option<Vec<String>>,
}

async fn bulk_upsert_servers(
    State(state): State<Arc<AppState>>,
    Path(profile_id): Path<String>,
    axum::Json(body): axum::Json<BulkServerStateBody>,
) -> Result<Json<Value>, AppError> {
    let items: Vec<crate::sidecar::db::profile_repo::ProfileServerUpsertInput> = body
        .updates
        .into_iter()
        .map(
            |update| crate::sidecar::db::profile_repo::ProfileServerUpsertInput {
                server_id: update.server_id,
                enabled: update.enabled,
                disabled_tools: update.disabled_tools,
            },
        )
        .collect();
    ProfileService::upsert_profile_servers_batch(&state.db, &state.event_bus, &profile_id, &items)
        .map_err(AppError::from)?;
    Ok(Json(json!({ "success": true, "updated": items.len() })))
}

async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, AppError> {
    let profiles = ProfileService::list(&state.db).map_err(AppError::from)?;
    Ok(Json(
        serde_json::to_value(profiles).map_err(|e| AppError::internal(e.to_string()))?,
    ))
}

#[derive(Deserialize)]
struct CreateBody {
    name: String,
}

async fn create(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<CreateBody>,
) -> Result<(axum::http::StatusCode, Json<Value>), AppError> {
    if body.name.is_empty() {
        return Err(AppError::validation("name is required"));
    }
    let profile = ProfileService::create(&state.db, &body.name).map_err(AppError::from)?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::to_value(profile).map_err(|e| AppError::internal(e.to_string()))?),
    ))
}

async fn get_one(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let (profile, servers) = ProfileService::get_detail(&state.db, &id).map_err(AppError::from)?;
    let mut profile_value =
        serde_json::to_value(profile).map_err(|e| AppError::internal(e.to_string()))?;
    if let Some(obj) = profile_value.as_object_mut() {
        obj.insert(
            "servers".to_string(),
            serde_json::to_value(servers).map_err(|e| AppError::internal(e.to_string()))?,
        );
    }
    Ok(Json(profile_value))
}

#[derive(Deserialize)]
struct UpdateBody {
    name: Option<String>,
}

async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<UpdateBody>,
) -> Result<Json<Value>, AppError> {
    let profile =
        ProfileService::update(&state.db, &id, body.name.as_deref()).map_err(AppError::from)?;
    Ok(Json(
        serde_json::to_value(profile).map_err(|e| AppError::internal(e.to_string()))?,
    ))
}

async fn remove(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    ProfileService::remove(&state.db, &id).map_err(AppError::from)?;
    Ok(Json(json!({ "success": true })))
}

async fn activate(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let profile =
        ProfileService::activate(&state.db, &state.event_bus, &id).map_err(AppError::from)?;
    Ok(Json(
        serde_json::to_value(profile).map_err(|e| AppError::internal(e.to_string()))?,
    ))
}

async fn get_profile_server(
    State(state): State<Arc<AppState>>,
    Path((profile_id, server_id)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let server = ProfileService::get_profile_server(&state.db, &profile_id, &server_id)
        .map_err(AppError::from)?;
    Ok(Json(
        serde_json::to_value(server).map_err(|e| AppError::internal(e.to_string()))?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertProfileServerBody {
    enabled: Option<bool>,
    disabled_tools: Option<Vec<String>>,
}

async fn upsert_profile_server(
    State(state): State<Arc<AppState>>,
    Path((profile_id, server_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<UpsertProfileServerBody>,
) -> Result<Json<Value>, AppError> {
    let result = ProfileService::upsert_profile_server(
        &state.db,
        &state.event_bus,
        &profile_id,
        &server_id,
        body.enabled,
        body.disabled_tools.as_ref(),
    )
    .map_err(AppError::from)?;
    Ok(Json(
        serde_json::to_value(result).map_err(|e| AppError::internal(e.to_string()))?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::db::profile_repo::ProfileRepository;
    use axum::body::Body;
    use std::sync::Arc;
    use std::time::SystemTime;
    use tower::ServiceExt;

    fn temp_data_dir(test_name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moor-profiles-route-{test_name}-{timestamp}"))
    }

    fn test_state(data_dir: std::path::PathBuf) -> Arc<AppState> {
        AppState::for_test(&data_dir)
    }

    #[tokio::test]
    async fn activate_profile_accepts_frontend_put_route() {
        let data_dir = temp_data_dir("activate-put");
        let state = test_state(data_dir.clone());
        let repo = ProfileRepository::new(&state.db);
        repo.seed_default().expect("failed to seed profile");
        let profile = repo.create("Work").expect("failed to create profile");

        let response = router()
            .with_state(state)
            .oneshot(
                axum::http::Request::builder()
                    .method(axum::http::Method::PUT)
                    .uri(format!("/api/profiles/{}/activate", profile.id))
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("route should respond");

        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    fn insert_server(db: &crate::sidecar::db::Database, id: &str, name: &str) {
        use crate::sidecar::db::server_repo::{ServerInsertInput, ServerRepository};
        ServerRepository::new(db)
            .insert_one_with_id(
                id,
                0,
                &ServerInsertInput {
                    name: name.into(),
                    connection_type: "stdio".into(),
                    command: Some("node".into()),
                    args: None,
                    url: None,
                    env: None,
                    headers: None,
                    working_dir: None,
                    auto_start: false,
                },
            )
            .expect("failed to insert server");
    }

    async fn body_json(response: axum::response::Response) -> Value {
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("response body should read");
        serde_json::from_slice(&bytes).expect("response should be json")
    }

    #[tokio::test]
    async fn clone_copies_server_states_as_inactive_profile() {
        let data_dir = temp_data_dir("clone-profile");
        let state = test_state(data_dir.clone());
        let repo = ProfileRepository::new(&state.db);
        repo.seed_default().expect("failed to seed profile");
        insert_server(&state.db, "srv-a", "Alpha");
        let active = repo.find_active_id().expect("active id").expect("active");
        repo.upsert_profile_server(&active, "srv-a", Some(false), Some(&vec!["t1".into()]))
            .expect("failed to set state");

        let response = router()
            .with_state(state.clone())
            .oneshot(
                axum::http::Request::builder()
                    .method(axum::http::Method::POST)
                    .uri(format!("/api/profiles/{active}/clone"))
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"name":"Work copy"}"#))
                    .expect("request should build"),
            )
            .await
            .expect("route should respond");

        assert_eq!(response.status(), axum::http::StatusCode::CREATED);
        let cloned = body_json(response).await;
        assert_eq!(cloned["name"], "Work copy");
        assert_eq!(cloned["isActive"], false);
        assert_eq!(cloned["serverCount"], 1);
        assert_eq!(
            repo.find_active_id().expect("active id"),
            Some(active),
            "cloning must not steal the active profile"
        );

        let empty_name = router()
            .with_state(state)
            .oneshot(
                axum::http::Request::builder()
                    .method(axum::http::Method::POST)
                    .uri(format!("/api/profiles/{}/clone", cloned["id"].as_str().unwrap()))
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"name":"  "}"#))
                    .expect("request should build"),
            )
            .await
            .expect("route should respond");
        assert_eq!(empty_name.status(), axum::http::StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn bulk_servers_state_updates_known_servers_and_rejects_unknown_ids() {
        let data_dir = temp_data_dir("bulk-state");
        let state = test_state(data_dir.clone());
        let repo = ProfileRepository::new(&state.db);
        repo.seed_default().expect("failed to seed profile");
        insert_server(&state.db, "srv-a", "Alpha");
        let active = repo.find_active_id().expect("active id").expect("active");

        let ok = router()
            .with_state(state.clone())
            .oneshot(
                axum::http::Request::builder()
                    .method(axum::http::Method::PUT)
                    .uri(format!("/api/profiles/{active}/servers-state"))
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"updates":[{"serverId":"srv-a","enabled":false,"disabledTools":["t1"]}]}"#,
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("route should respond");
        assert_eq!(ok.status(), axum::http::StatusCode::OK);
        assert_eq!(body_json(ok).await["updated"], 1);

        let state_after = repo
            .find_profile_servers(&active)
            .expect("profile servers")
            .into_iter()
            .find(|server| server.server.id == "srv-a")
            .expect("bound server");
        assert!(!state_after.profile_server.enabled);
        assert_eq!(
            state_after.profile_server.disabled_tools,
            vec!["t1".to_string()]
        );

        let unknown = router()
            .with_state(state.clone())
            .oneshot(
                axum::http::Request::builder()
                    .method(axum::http::Method::PUT)
                    .uri(format!("/api/profiles/{active}/servers-state"))
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"updates":[{"serverId":"missing","enabled":true}]}"#,
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("route should respond");
        assert_eq!(unknown.status(), axum::http::StatusCode::BAD_REQUEST);

        let missing_profile = router()
            .with_state(state)
            .oneshot(
                axum::http::Request::builder()
                    .method(axum::http::Method::PUT)
                    .uri("/api/profiles/does-not-exist/servers-state")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"updates":[]}"#))
                    .expect("request should build"),
            )
            .await
            .expect("route should respond");
        assert_eq!(missing_profile.status(), axum::http::StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn profile_tools_returns_grouped_matrix_with_disabled_flags() {
        let data_dir = temp_data_dir("profile-tools");
        let state = test_state(data_dir.clone());
        let repo = ProfileRepository::new(&state.db);
        repo.seed_default().expect("failed to seed profile");
        insert_server(&state.db, "srv-a", "Alpha");
        let active = repo.find_active_id().expect("active id").expect("active");
        repo.upsert_profile_server(&active, "srv-a", Some(true), Some(&vec!["search".into()]))
            .expect("failed to set state");
        crate::sidecar::db::tool_discovery_repo::ToolDiscoveryRepository::new(&state.db)
            .replace_tools_for_server(
                "srv-a",
                &[crate::sidecar::db::tool_discovery_repo::ToolInsert {
                    name: "search".into(),
                    description: Some("Search things".into()),
                    input_schema: None,
                }],
            )
            .expect("failed to seed tools");

        let response = router()
            .with_state(state)
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!("/api/profiles/{active}/tools"))
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("route should respond");

        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let groups = body_json(response).await;
        let group = &groups.as_array().expect("groups should be array")[0];
        assert_eq!(group["serverId"], "srv-a");
        assert_eq!(group["serverName"], "Alpha");
        assert_eq!(group["serverEnabled"], true);
        assert_eq!(group["tools"][0]["toolName"], "search");
        assert_eq!(group["tools"][0]["disabled"], true);
        let _ = std::fs::remove_dir_all(data_dir);
    }
}
