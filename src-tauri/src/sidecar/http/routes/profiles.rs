use crate::sidecar::db::profile_repo::{ProfileRepository, RemoveResult};
use crate::sidecar::http::{
    internal_error, not_found, validation_error, ApiErrorResponse, AppState,
};
use axum::{
    extract::{Path, State},
    response::Json,
    routing::{get, post},
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
        .route("/api/profiles/{id}/activate", post(activate))
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
