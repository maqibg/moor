use crate::sidecar::services::event_bus::Evt;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{broadcast, Mutex};

const DEFAULT_SESSION_TTL: Duration = Duration::from_secs(30 * 60);
const DEFAULT_MAX_SESSIONS: usize = 256;
const SESSION_EVENT_CAPACITY: usize = 32;

#[derive(Debug, Clone, PartialEq)]
pub struct McpSessionSnapshot {
    pub protocol_version: String,
}

struct SessionEntry {
    protocol_version: String,
    last_seen_at: Instant,
    sender: broadcast::Sender<Value>,
}

impl SessionEntry {
    fn snapshot(&self) -> McpSessionSnapshot {
        McpSessionSnapshot {
            protocol_version: self.protocol_version.clone(),
        }
    }
}

pub struct McpSessionStore {
    sessions: Mutex<HashMap<String, SessionEntry>>,
    global_sender: broadcast::Sender<Value>,
    ttl: Duration,
    max_sessions: usize,
}

impl McpSessionStore {
    pub fn new() -> Self {
        Self::with_limits(DEFAULT_SESSION_TTL, DEFAULT_MAX_SESSIONS)
    }

    fn with_limits(ttl: Duration, max_sessions: usize) -> Self {
        let (global_sender, _) = broadcast::channel(SESSION_EVENT_CAPACITY);
        Self {
            sessions: Mutex::new(HashMap::new()),
            global_sender,
            ttl,
            max_sessions: max_sessions.max(1),
        }
    }

    pub async fn create(&self, protocol_version: &str) -> String {
        let now = Instant::now();
        let mut sessions = self.sessions.lock().await;
        self.prune_expired(&mut sessions, now);

        if sessions.len() >= self.max_sessions {
            if let Some(oldest_id) = sessions
                .iter()
                .min_by_key(|(_, entry)| entry.last_seen_at)
                .map(|(id, _)| id.clone())
            {
                sessions.remove(&oldest_id);
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let (sender, _) = broadcast::channel(SESSION_EVENT_CAPACITY);
        sessions.insert(
            id.clone(),
            SessionEntry {
                protocol_version: protocol_version.to_string(),
                last_seen_at: now,
                sender,
            },
        );
        id
    }

    pub async fn get(&self, session_id: &str) -> Option<McpSessionSnapshot> {
        let now = Instant::now();
        let mut sessions = self.sessions.lock().await;
        self.prune_expired(&mut sessions, now);
        let entry = sessions.get_mut(session_id)?;
        entry.last_seen_at = now;
        Some(entry.snapshot())
    }

    pub async fn subscribe(&self, session_id: &str) -> Option<broadcast::Receiver<Value>> {
        let now = Instant::now();
        let mut sessions = self.sessions.lock().await;
        self.prune_expired(&mut sessions, now);
        let entry = sessions.get_mut(session_id)?;
        entry.last_seen_at = now;
        Some(entry.sender.subscribe())
    }

    pub fn subscribe_global(&self) -> broadcast::Receiver<Value> {
        self.global_sender.subscribe()
    }

    pub async fn remove(&self, session_id: &str) -> bool {
        self.sessions.lock().await.remove(session_id).is_some()
    }

    pub async fn publish_tools_list_changed(&self) {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/tools/list_changed"
        });
        let _ = self.global_sender.send(notification.clone());

        let now = Instant::now();
        let mut sessions = self.sessions.lock().await;
        self.prune_expired(&mut sessions, now);
        for entry in sessions.values() {
            let _ = entry.sender.send(notification.clone());
        }
    }

    fn prune_expired(&self, sessions: &mut HashMap<String, SessionEntry>, now: Instant) {
        sessions.retain(|_, entry| now.duration_since(entry.last_seen_at) < self.ttl);
    }

    #[cfg(test)]
    async fn len(&self) -> usize {
        self.sessions.lock().await.len()
    }
}

impl Default for McpSessionStore {
    fn default() -> Self {
        Self::new()
    }
}

pub async fn forward_tool_list_changes(
    mut receiver: broadcast::Receiver<Evt>,
    sessions: Arc<McpSessionStore>,
) {
    loop {
        match receiver.recv().await {
            Ok(Evt::ServerTools { .. } | Evt::ProfileActivated { .. }) => {
                sessions.publish_tools_list_changed().await;
            }
            Ok(Evt::ServerStatus { status, .. }) if status == "stopped" || status == "error" => {
                sessions.publish_tools_list_changed().await;
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {
                // Catalog notifications are idempotent; after lagging, one
                // fresh notification is enough to make clients re-list.
                sessions.publish_tools_list_changed().await;
            }
            Ok(_) => {}
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::services::event_bus::EventBus;

    #[tokio::test]
    async fn creates_reads_and_removes_session() {
        let store = McpSessionStore::new();
        let id = store.create("2025-11-25").await;

        let snapshot = store.get(&id).await.expect("session should exist");
        assert_eq!(snapshot.protocol_version, "2025-11-25");
        assert!(store.remove(&id).await);
        assert!(store.get(&id).await.is_none());
    }

    #[tokio::test]
    async fn expires_idle_sessions() {
        let store = McpSessionStore::with_limits(Duration::from_millis(10), 8);
        let id = store.create("2025-11-25").await;
        tokio::time::sleep(Duration::from_millis(20)).await;

        assert!(store.get(&id).await.is_none());
        assert_eq!(store.len().await, 0);
    }

    #[tokio::test]
    async fn evicts_least_recent_session_at_capacity() {
        let store = McpSessionStore::with_limits(Duration::from_secs(60), 1);
        let first = store.create("2025-03-26").await;
        let second = store.create("2025-11-25").await;

        assert!(store.get(&first).await.is_none());
        assert!(store.get(&second).await.is_some());
    }

    #[tokio::test]
    async fn forwards_profile_changes_as_mcp_notifications() {
        let event_bus = Arc::new(EventBus::new(8));
        let store = Arc::new(McpSessionStore::new());
        let mut receiver = store.subscribe_global();
        let task = tokio::spawn(forward_tool_list_changes(
            event_bus.subscribe(),
            store.clone(),
        ));

        event_bus.emit(Evt::ProfileActivated {
            profile_id: "profile-a".to_string(),
        });

        let message = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
            .await
            .expect("notification should arrive")
            .expect("notification channel should remain open");
        assert_eq!(message["method"], "notifications/tools/list_changed");

        event_bus.emit(Evt::ServerStatus {
            server_id: "server-a".to_string(),
            status: "stopped".to_string(),
            error_message: None,
        });
        let stopped_message = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
            .await
            .expect("status notification should arrive")
            .expect("notification channel should remain open");
        assert_eq!(
            stopped_message["method"],
            "notifications/tools/list_changed"
        );
        task.abort();
    }
}
