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
            .text(":heartbeat\n\n"),
    )
}
