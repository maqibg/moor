use crate::sidecar::http::AppState;
use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
    routing::get,
    Router,
};
use futures::stream::Stream;
use std::{convert::Infallible, sync::Arc};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/api/events", get(events))
}

async fn events(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.event_bus.subscribe();
    let stream = BroadcastStream::new(receiver);

    let initial = futures::stream::once(async {
        Ok(Event::default()
            .event("connected")
            .data(serde_json::json!({"timestamp": chrono::Utc::now().to_rfc3339()}).to_string()))
    });

    let event_stream = stream.filter_map(|result| match result {
        Ok((event_type, data)) => {
            let event = Event::default().event(&event_type).data(data.to_string());
            Some(Ok(event))
        }
        Err(_) => None,
    });

    let combined = initial.chain(event_stream);

    Sse::new(combined).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(30))
            .text("heartbeat"),
    )
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
        std::env::temp_dir().join(format!("moor-events-route-{test_name}-{timestamp}"))
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
            data_dir,
            event_bus: event_bus.clone(),
            server_manager: Arc::new(ServerManager::new(db, event_bus)),
        })
    }

    #[tokio::test]
    async fn events_stream_constructs_keep_alive_without_panicking() {
        let data_dir = temp_data_dir("keep-alive");
        let state = test_state(data_dir.clone());

        let _stream = events(State(state)).await;

        let _ = std::fs::remove_dir_all(data_dir);
    }
}
