use crate::sidecar::db::profile_repo::{ProfileRepository, RemoveResult};
use crate::sidecar::http::{
    internal_error, not_found, validation_error, ApiErrorResponse, AppState,
};
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
        .route(
            "/api/profiles/{profileId}/servers/{serverId}",
            get(get_profile_server).put(upsert_profile_server),
        )
}

async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ProfileRepository::new(&state.db);
    let profiles = repo
        .find_all()
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    Ok(Json(serde_json::to_value(profiles).unwrap()))
}

#[derive(Deserialize)]
struct CreateBody {
    name: String,
}

async fn create(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<CreateBody>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiErrorResponse> {
    if body.name.is_empty() {
        return Err(api_error("VALIDATION_ERROR", "name is required"));
    }
    let repo = ProfileRepository::new(&state.db);
    let profile = repo
        .create(&body.name)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::to_value(profile).unwrap()),
    ))
}

async fn get_one(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ProfileRepository::new(&state.db);
    let profile = repo
        .find_by_id(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?
        .ok_or_else(|| api_error("NOT_FOUND", "Profile not found"))?;
    let servers = repo
        .find_profile_servers(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    let mut profile_value = serde_json::to_value(profile).unwrap();
    if let Some(obj) = profile_value.as_object_mut() {
        obj.insert(
            "servers".to_string(),
            serde_json::to_value(servers).unwrap(),
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
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ProfileRepository::new(&state.db);
    let profile = repo
        .update(&id, body.name.as_deref())
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?
        .ok_or_else(|| api_error("NOT_FOUND", "Profile not found"))?;
    Ok(Json(serde_json::to_value(profile).unwrap()))
}

async fn remove(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ProfileRepository::new(&state.db);
    match repo
        .remove(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?
    {
        RemoveResult::Success => Ok(Json(json!({ "success": true }))),
        RemoveResult::NotFound => Err(api_error("NOT_FOUND", "Profile not found")),
        RemoveResult::Active => Err(api_error("ACTIVE_PROFILE", "Cannot delete active profile")),
    }
}

async fn activate(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ProfileRepository::new(&state.db);
    let profile = repo
        .activate(&id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?
        .ok_or_else(|| api_error("NOT_FOUND", "Profile not found"))?;
    state.event_bus.emit(
        "profile:activated",
        serde_json::json!({ "type": "profile:activated", "data": { "profileId": id, "profile": profile } }),
    );
    Ok(Json(serde_json::to_value(profile).unwrap()))
}

async fn get_profile_server(
    State(state): State<Arc<AppState>>,
    Path((profile_id, server_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ProfileRepository::new(&state.db);
    let servers = repo
        .find_profile_servers(&profile_id)
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    let server = servers
        .into_iter()
        .find(|s| s.server.id == server_id)
        .ok_or_else(|| api_error("NOT_FOUND", "Server not found in profile"))?;
    Ok(Json(serde_json::to_value(server).unwrap()))
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
) -> Result<Json<Value>, ApiErrorResponse> {
    let repo = ProfileRepository::new(&state.db);
    let result = repo
        .upsert_profile_server(
            &profile_id,
            &server_id,
            body.enabled,
            body.disabled_tools.as_ref(),
        )
        .map_err(|e| api_error("INTERNAL_ERROR", &e))?;
    Ok(Json(serde_json::to_value(result).unwrap()))
}

fn api_error(code: &str, message: &str) -> ApiErrorResponse {
    match code {
        "VALIDATION_ERROR" | "ACTIVE_PROFILE" => validation_error(message.to_string()),
        "NOT_FOUND" => not_found(message.to_string()),
        _ => internal_error(message.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::db::profile_repo::ProfileRepository;
    use crate::sidecar::db::Database;
    use crate::sidecar::services::event_bus::EventBus;
    use crate::sidecar::services::server_manager::ServerManager;
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
}
