use crate::sidecar::http::{internal_error, validation_error, ApiResult, AppState};
use crate::sidecar::services::settings as settings_store;
use axum::{
    extract::State,
    response::Json,
    routing::{get, post},
    Router,
};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/settings", get(get_settings).patch(update_settings))
        .route("/api/settings/reset", post(reset_settings))
}

async fn get_settings(State(state): State<Arc<AppState>>) -> ApiResult<Value> {
    let settings = settings_store::read_settings_file(&state.data_dir);
    Ok(Json(
        serde_json::to_value(settings).unwrap_or_else(|_| json!({})),
    ))
}

async fn update_settings(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<Value>,
) -> ApiResult<Value> {
    let settings =
        settings_store::update_settings_file(&state.data_dir, body).map_err(validation_error)?;
    let settings_value = serde_json::to_value(&settings).unwrap_or_else(|_| json!({}));

    state
        .event_bus
        .emit("settings:changed", settings_value.clone());
    Ok(Json(settings_value))
}

async fn reset_settings(State(state): State<Arc<AppState>>) -> ApiResult<Value> {
    let defaults = settings_store::reset_settings_file(&state.data_dir).map_err(internal_error)?;
    let defaults_value = serde_json::to_value(&defaults).unwrap_or_else(|_| json!({}));
    state
        .event_bus
        .emit("settings:changed", defaults_value.clone());
    Ok(Json(defaults_value))
}

#[cfg(test)]
mod tests {
    use super::*;
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
        std::env::temp_dir().join(format!("moor-settings-route-{test_name}-{timestamp}"))
    }

    fn test_state(data_dir: std::path::PathBuf) -> Arc<AppState> {
        std::fs::create_dir_all(&data_dir).expect("failed to create temp data dir");
        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        let event_bus = Arc::new(EventBus::new(16));
        Arc::new(AppState {
            db: db.clone(),
            api_token: "test-token".to_string(),
            version: "test".to_string(),
            port: 19323,
            data_dir,
            event_bus: event_bus.clone(),
            server_manager: Arc::new(ServerManager::new(db, event_bus)),
        })
    }

    #[tokio::test]
    async fn get_settings_returns_defaults_for_fresh_store() {
        let data_dir = temp_data_dir("fresh");
        let Json(value) = get_settings(State(test_state(data_dir.clone())))
            .await
            .expect("settings should load");
        assert_eq!(value["advanced"]["sidecarPort"], 9223);
        assert_eq!(value["general"]["minimizeToTrayOnClose"], true);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn reset_settings_returns_defaults_and_writes_file() {
        let data_dir = temp_data_dir("reset");
        let state = test_state(data_dir.clone());
        let _ = update_settings(
            State(state.clone()),
            axum::Json(serde_json::json!({ "advanced": { "sidecarPort": 9333 } })),
        )
        .await
        .expect("settings update should succeed");

        let Json(value) = reset_settings(State(state))
            .await
            .expect("settings reset should succeed");
        assert_eq!(value["advanced"]["sidecarPort"], 9223);
        assert_eq!(
            settings_store::read_settings_file(&data_dir)
                .advanced
                .sidecar_port,
            9223
        );
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn settings_changed_event_payload_is_settings_object() {
        let data_dir = temp_data_dir("event-payload");
        let state = test_state(data_dir.clone());
        let mut events = state.event_bus.subscribe();

        let Json(value) = update_settings(
            State(state),
            axum::Json(serde_json::json!({
                "general": { "minimizeToTrayOnClose": false }
            })),
        )
        .await
        .expect("settings update should succeed");

        let (event, payload) = events
            .recv()
            .await
            .expect("settings event should be emitted");
        assert_eq!(event, "settings:changed");
        assert_eq!(payload, value);
        assert_eq!(payload["general"]["minimizeToTrayOnClose"], false);
        let _ = std::fs::remove_dir_all(data_dir);
    }
}
