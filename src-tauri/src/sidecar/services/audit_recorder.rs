//! 工具调用审计记录器。
//!
//! 请求路径只负责把拥有所有权的记录放入有界队列。脱敏、序列化和批量写库
//! 由后台任务完成，避免审计 I/O 增加工具调用响应延迟。

use crate::sidecar::db::audit_log_repo::{AuditLogInsert, AuditLogRepository};
use crate::sidecar::db::Database;
use crate::sidecar::services::audit_redaction::redact_for_audit;
use crate::sidecar::services::settings::SettingsCache;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
#[cfg(test)]
use tokio::sync::oneshot;

const AUDIT_QUEUE_CAPACITY: usize = 1024;
const AUDIT_BATCH_SIZE: usize = 64;
const RETENTION_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

pub struct ToolCallRecord<'a> {
    pub profile_id: Option<&'a str>,
    pub server_id: Option<&'a str>,
    pub tool_name: &'a str,
    pub arguments: &'a serde_json::Value,
    pub result: Option<&'a serde_json::Value>,
    pub error: Option<&'a str>,
    pub duration_ms: i64,
    pub agent_info: Option<&'a str>,
}

struct OwnedToolCallRecord {
    timestamp: String,
    profile_id: Option<String>,
    server_id: Option<String>,
    tool_name: String,
    arguments: serde_json::Value,
    result: Option<serde_json::Value>,
    error: Option<String>,
    duration_ms: i64,
    agent_info: Option<String>,
}

enum AuditCommand {
    Record(Box<OwnedToolCallRecord>),
    #[cfg(test)]
    Flush(oneshot::Sender<()>),
}

pub struct AuditRecorder {
    sender: mpsc::Sender<AuditCommand>,
    settings: Arc<SettingsCache>,
}

impl AuditRecorder {
    pub fn start(db: Arc<Database>, settings: Arc<SettingsCache>) -> Arc<Self> {
        let (sender, receiver) = mpsc::channel(AUDIT_QUEUE_CAPACITY);
        tauri::async_runtime::spawn(run_writer(db.clone(), receiver));
        tauri::async_runtime::spawn(run_retention(db, settings.clone()));
        Arc::new(Self { sender, settings })
    }

    #[cfg(test)]
    pub fn start_writer_only(db: Arc<Database>, settings: Arc<SettingsCache>) -> Arc<Self> {
        let (sender, receiver) = mpsc::channel(AUDIT_QUEUE_CAPACITY);
        tauri::async_runtime::spawn(run_writer(db, receiver));
        Arc::new(Self { sender, settings })
    }

    pub fn record(&self, entry: ToolCallRecord<'_>) {
        if !self.settings.snapshot().advanced.enable_audit_logging {
            return;
        }

        let entry = OwnedToolCallRecord {
            timestamp: chrono::Utc::now().to_rfc3339(),
            profile_id: entry.profile_id.map(str::to_string),
            server_id: entry.server_id.map(str::to_string),
            tool_name: entry.tool_name.to_string(),
            arguments: entry.arguments.clone(),
            result: entry.result.cloned(),
            error: entry.error.map(str::to_string),
            duration_ms: entry.duration_ms,
            agent_info: entry.agent_info.map(str::to_string),
        };
        if let Err(error) = self.sender.try_send(AuditCommand::Record(Box::new(entry))) {
            tracing::warn!("Audit queue rejected a tool call record: {error}");
        }
    }

    #[cfg(test)]
    pub async fn flush(&self) {
        let (sender, receiver) = oneshot::channel();
        if self.sender.send(AuditCommand::Flush(sender)).await.is_ok() {
            let _ = receiver.await;
        }
    }
}

async fn run_writer(db: Arc<Database>, mut receiver: mpsc::Receiver<AuditCommand>) {
    while let Some(command) = receiver.recv().await {
        match command {
            #[cfg(test)]
            AuditCommand::Flush(sender) => {
                let _ = sender.send(());
            }
            AuditCommand::Record(first) => {
                let mut batch = vec![*first];
                #[cfg(test)]
                let mut flush_waiters: Vec<oneshot::Sender<()>> = Vec::new();
                while batch.len() < AUDIT_BATCH_SIZE {
                    match receiver.try_recv() {
                        Ok(AuditCommand::Record(entry)) => batch.push(*entry),
                        #[cfg(test)]
                        Ok(AuditCommand::Flush(sender)) => flush_waiters.push(sender),
                        Err(_) => break,
                    }
                }

                let write_db = db.clone();
                let write_result =
                    tokio::task::spawn_blocking(move || write_batch(&write_db, batch)).await;
                match write_result {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => tracing::warn!("Failed to write audit batch: {error}"),
                    Err(error) => tracing::warn!("Audit writer task failed: {error}"),
                }
                #[cfg(test)]
                {
                    for waiter in flush_waiters {
                        let _ = waiter.send(());
                    }
                }
            }
        }
    }
}

fn write_batch(db: &Database, batch: Vec<OwnedToolCallRecord>) -> Result<(), String> {
    let entries = batch
        .into_iter()
        .map(|entry| AuditLogInsert {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: entry.timestamp,
            profile_id: entry.profile_id,
            server_id: entry.server_id,
            tool_name: entry.tool_name,
            arguments: Some(redact_for_audit(&entry.arguments)),
            result: entry.result.as_ref().map(redact_for_audit),
            error: entry.error,
            duration_ms: entry.duration_ms,
            agent_info: entry.agent_info,
        })
        .collect::<Vec<_>>();
    AuditLogRepository::new(db).insert_batch(&entries)
}

async fn run_retention(db: Arc<Database>, settings: Arc<SettingsCache>) {
    loop {
        let retention_days = settings.snapshot().advanced.log_retention_days;
        if retention_days > 0 {
            let cleanup_db = db.clone();
            let result = tokio::task::spawn_blocking(move || {
                cleanup_expired_logs(&cleanup_db, retention_days, chrono::Utc::now())
            })
            .await;
            match result {
                Ok(Ok(_)) => {}
                Ok(Err(error)) => tracing::warn!("Failed to clean expired audit logs: {error}"),
                Err(error) => tracing::warn!("Audit retention task failed: {error}"),
            }
        }
        tokio::time::sleep(RETENTION_INTERVAL).await;
    }
}

fn cleanup_expired_logs(
    db: &Database,
    retention_days: u16,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<usize, String> {
    if retention_days == 0 {
        return Ok(0);
    }
    let cutoff = now - chrono::Duration::days(i64::from(retention_days));
    let deleted = AuditLogRepository::new(db).delete_before(&cutoff.to_rfc3339())?;
    if deleted > 0 {
        db.ensure_incremental_auto_vacuum()?;
        db.incremental_vacuum(2_000)?;
    }
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    fn temp_database(test_name: &str) -> (Arc<Database>, std::path::PathBuf) {
        let suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time should follow the unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("moor-audit-{test_name}-{suffix}.db"));
        let db = Arc::new(Database::open(&path).expect("open test database"));
        db.run_migrations().expect("migrate test database");
        (db, path)
    }

    #[tokio::test]
    async fn writer_redacts_and_flushes_queued_records() {
        let (db, path) = temp_database("writer");
        let (sender, receiver) = mpsc::channel(8);
        let writer = tokio::spawn(run_writer(db.clone(), receiver));
        sender
            .send(AuditCommand::Record(Box::new(OwnedToolCallRecord {
                timestamp: "2026-03-01T00:00:00Z".to_string(),
                profile_id: Some("deleted-profile".to_string()),
                server_id: Some("deleted-server".to_string()),
                tool_name: "search".to_string(),
                arguments: serde_json::json!({ "token": "secret", "query": "moor" }),
                result: Some(serde_json::json!({ "ok": true })),
                error: None,
                duration_ms: 12,
                agent_info: Some("test".to_string()),
            })))
            .await
            .expect("queue record");
        let (flushed_tx, flushed_rx) = oneshot::channel();
        sender
            .send(AuditCommand::Flush(flushed_tx))
            .await
            .expect("queue flush");
        flushed_rx.await.expect("flush should complete");
        drop(sender);
        writer.await.expect("writer should stop cleanly");

        let logs = AuditLogRepository::new(&db)
            .query_logs(None, Some("search"), None, None, Some(10), None)
            .expect("query audit logs");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].profile_id, None);
        assert_eq!(logs[0].server_id, None);
        assert_eq!(logs[0].timestamp, "2026-03-01T00:00:00Z");
        assert_eq!(logs[0].arguments.as_ref().unwrap()["token"], "[REDACTED]");
        assert_eq!(logs[0].arguments.as_ref().unwrap()["query"], "moor");

        drop(db);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn retention_deletes_only_entries_older_than_the_cutoff() {
        let (db, path) = temp_database("retention");
        let repo = AuditLogRepository::new(&db);
        repo.insert(
            "old",
            "2026-01-01T00:00:00Z",
            None,
            None,
            "old-tool",
            None,
            None,
            None,
            1,
            None,
        )
        .expect("insert old log");
        repo.insert(
            "recent",
            "2026-02-20T00:00:00Z",
            None,
            None,
            "recent-tool",
            None,
            None,
            None,
            1,
            None,
        )
        .expect("insert recent log");
        let now = chrono::DateTime::parse_from_rfc3339("2026-03-01T00:00:00Z")
            .expect("parse test timestamp")
            .with_timezone(&chrono::Utc);

        assert_eq!(cleanup_expired_logs(&db, 30, now).expect("clean logs"), 1);
        let logs = repo
            .query_logs(None, None, None, None, Some(10), None)
            .expect("query remaining logs");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].id, "recent");

        drop(db);
        let _ = std::fs::remove_file(path);
    }
}
