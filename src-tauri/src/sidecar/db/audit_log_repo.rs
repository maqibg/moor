use super::Database;
use serde::{Deserialize, Serialize};

/// Audit timestamps are stored as UTC RFC3339 with fixed nanosecond precision so
/// lexicographic SQL comparisons are also chronological.
pub(crate) fn normalize_timestamp(timestamp: &str) -> Result<String, String> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .map(|value| {
            value
                .with_timezone(&chrono::Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true)
        })
        .map_err(|_| "Timestamp must be a valid RFC3339 value".to_string())
}

/// Normalizes both window bounds and rejects inverted ranges; callers apply the
/// window as a half-open `[from, to)` interval.
pub(crate) fn normalize_time_window(
    from: Option<&str>,
    to: Option<&str>,
) -> Result<(Option<String>, Option<String>), String> {
    let from = from.map(normalize_timestamp).transpose()?;
    let to = to.map(normalize_timestamp).transpose()?;
    if let (Some(from), Some(to)) = (&from, &to) {
        if from > to {
            return Err("Time window start must not be after its end".to_string());
        }
    }
    Ok((from, to))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub id: String,
    pub timestamp: String,
    pub profile_id: Option<String>,
    pub server_id: Option<String>,
    pub tool_name: String,
    pub arguments: Option<serde_json::Value>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub agent_info: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogStats {
    pub total_calls: i64,
    pub error_calls: i64,
    pub error_rate: f64,
    pub avg_duration_ms: Option<f64>,
    pub top_tools: Vec<TopTool>,
    pub top_servers: Vec<TopServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopTool {
    pub tool_name: String,
    pub count: i64,
    pub avg_duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopServer {
    pub server_id: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInsight {
    pub tool_name: String,
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    pub call_count: i64,
    pub error_count: i64,
    pub error_rate: f64,
    pub avg_duration_ms: Option<f64>,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub last_called_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInsight {
    pub server_id: String,
    pub server_name: Option<String>,
    pub call_count: i64,
    pub error_count: i64,
    pub error_rate: f64,
    pub avg_duration_ms: Option<f64>,
    pub last_called_at: Option<String>,
}

/// Tool-call insights within a time window, aggregated by (server, tool) and by
/// server. Coexists with the windowless `LogStats` used by the dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogInsights {
    pub total_calls: i64,
    pub error_calls: i64,
    pub error_rate: f64,
    pub avg_duration_ms: Option<f64>,
    pub tools: Vec<ToolInsight>,
    pub servers: Vec<ServerInsight>,
}

/// Nearest-rank percentile over already-sorted values: rank = ceil(q/100 * n).
fn percentile_nearest_rank(values: &[f64], q: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let rank = ((q / 100.0) * values.len() as f64).ceil() as usize;
    let index = rank.clamp(1, values.len()) - 1;
    Some(values[index])
}

pub struct AuditLogInsert {
    pub id: String,
    pub timestamp: String,
    pub profile_id: Option<String>,
    pub server_id: Option<String>,
    pub tool_name: String,
    pub arguments: Option<serde_json::Value>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: i64,
    pub agent_info: Option<String>,
}

fn map_audit_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuditLogEntry> {
    let args_str: Option<String> = row.get("arguments")?;
    let result_str: Option<String> = row.get("result")?;
    Ok(AuditLogEntry {
        id: row.get("id")?,
        timestamp: row.get("timestamp")?,
        profile_id: row.get("profile_id")?,
        server_id: row.get("server_id")?,
        tool_name: row.get("tool_name")?,
        arguments: args_str.and_then(|s| serde_json::from_str(&s).ok()),
        result: result_str.and_then(|s| serde_json::from_str(&s).ok()),
        error: row.get("error")?,
        duration_ms: row.get("duration_ms")?,
        agent_info: row.get("agent_info")?,
    })
}

pub struct AuditLogRepository<'a> {
    pub db: &'a Database,
}

impl<'a> AuditLogRepository<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn query_logs(
        &self,
        server_id: Option<&str>,
        tool_name: Option<&str>,
        from: Option<&str>,
        to: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<AuditLogEntry>, String> {
        let (from, to) = normalize_time_window(from, to)?;
        let mut sql = "SELECT * FROM audit_logs WHERE 1=1".to_string();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(sid) = server_id {
            sql += " AND server_id = ?";
            params.push(Box::new(sid.to_string()));
        }
        if let Some(tn) = tool_name {
            sql += " AND tool_name = ?";
            params.push(Box::new(tn.to_string()));
        }
        if let Some(f) = from {
            sql += " AND timestamp >= ?";
            params.push(Box::new(f.to_string()));
        }
        if let Some(t) = to {
            sql += " AND timestamp < ?";
            params.push(Box::new(t.to_string()));
        }

        let safe_limit = limit.map_or(50, |l| l.clamp(1, 200));
        let safe_offset = offset.unwrap_or(0);
        sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
        params.push(Box::new(safe_limit));
        params.push(Box::new(safe_offset));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        self.db.query_all(&sql, &param_refs, map_audit_log)
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub fn insert(
        &self,
        id: &str,
        timestamp: &str,
        profile_id: Option<&str>,
        server_id: Option<&str>,
        tool_name: &str,
        arguments: Option<&serde_json::Value>,
        result: Option<&serde_json::Value>,
        error: Option<&str>,
        duration_ms: i64,
        agent_info: Option<&str>,
    ) -> Result<(), String> {
        let timestamp = normalize_timestamp(timestamp)?;
        let args_json = arguments.map(|v| serde_json::to_string(v).unwrap_or_default());
        let result_json = result.map(|v| serde_json::to_string(v).unwrap_or_default());
        self.db.run(
            "INSERT INTO audit_logs (id, timestamp, profile_id, server_id, tool_name, arguments, result, error, duration_ms, agent_info)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            &[&id, &timestamp, &profile_id, &server_id, &tool_name, &args_json, &result_json, &error, &duration_ms, &agent_info],
        )
    }

    pub fn insert_batch(&self, entries: &[AuditLogInsert]) -> Result<(), String> {
        if entries.is_empty() {
            return Ok(());
        }
        self.db.transaction(|conn| {
            let mut statement = conn
                .prepare_cached(
                    "INSERT INTO audit_logs (id, timestamp, profile_id, server_id, tool_name, arguments, result, error, duration_ms, agent_info)
                     VALUES (?1, ?2, (SELECT id FROM profiles WHERE id = ?3), (SELECT id FROM mcp_servers WHERE id = ?4), ?5, ?6, ?7, ?8, ?9, ?10)",
                )
                .map_err(|error| error.to_string())?;
            for entry in entries {
                let timestamp = normalize_timestamp(&entry.timestamp)?;
                let arguments = entry
                    .arguments
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()
                    .map_err(|error| error.to_string())?;
                let result = entry
                    .result
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()
                    .map_err(|error| error.to_string())?;
                statement
                    .execute(rusqlite::params![
                        &entry.id,
                        &timestamp,
                        entry.profile_id.as_deref(),
                        entry.server_id.as_deref(),
                        &entry.tool_name,
                        arguments.as_deref(),
                        result.as_deref(),
                        entry.error.as_deref(),
                        entry.duration_ms,
                        entry.agent_info.as_deref(),
                    ])
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    pub fn delete_before(&self, cutoff: &str) -> Result<usize, String> {
        let cutoff = normalize_timestamp(cutoff)?;
        self.db.transaction(|conn| {
            conn.execute("DELETE FROM audit_logs WHERE timestamp < ?1", [&cutoff])
                .map_err(|error| error.to_string())
        })
    }

    /// Aggregates tool-call usage inside a half-open `[from, to)` window.
    /// Durations are pulled per call and sorted in memory; the row count is
    /// bounded by the audit retention setting.
    pub fn get_insights(
        &self,
        from: Option<&str>,
        to: Option<&str>,
    ) -> Result<LogInsights, String> {
        let (from, to) = normalize_time_window(from, to)?;
        let mut conditions = String::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(f) = from {
            conditions += " AND a.timestamp >= ?";
            params.push(Box::new(f));
        }
        if let Some(t) = to {
            conditions += " AND a.timestamp < ?";
            params.push(Box::new(t));
        }
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();

        let (total_calls, error_calls, avg_duration_ms) = self
            .db
            .query_one(
                &format!(
                    "SELECT COUNT(*), COALESCE(SUM(CASE WHEN a.error IS NOT NULL THEN 1 ELSE 0 END), 0), AVG(a.duration_ms)
                     FROM audit_logs a WHERE 1=1{conditions}"
                ),
                &param_refs,
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<f64>>(2)?,
                    ))
                },
            )?
            .unwrap_or((0, 0, None));
        let error_rate = if total_calls > 0 {
            error_calls as f64 / total_calls as f64
        } else {
            0.0
        };

        let mut durations: std::collections::HashMap<(Option<String>, String), Vec<f64>> =
            std::collections::HashMap::new();
        self.db.query_all(
            &format!(
                "SELECT a.server_id, a.tool_name, a.duration_ms FROM audit_logs a
                 WHERE a.duration_ms IS NOT NULL{conditions}"
            ),
            &param_refs,
            |row| {
                let key = (row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?);
                durations
                    .entry(key)
                    .or_default()
                    .push(row.get::<_, f64>(2)?);
                Ok(())
            },
        )?;

        let mut tools = self.db.query_all(
            &format!(
                "SELECT a.tool_name, a.server_id, s.name AS server_name, COUNT(*) AS call_count,
                        COALESCE(SUM(CASE WHEN a.error IS NOT NULL THEN 1 ELSE 0 END), 0) AS error_count,
                        AVG(a.duration_ms) AS avg_duration_ms, MAX(a.timestamp) AS last_called_at
                 FROM audit_logs a LEFT JOIN mcp_servers s ON s.id = a.server_id
                 WHERE 1=1{conditions}
                 GROUP BY a.server_id, a.tool_name
                 ORDER BY call_count DESC"
            ),
            &param_refs,
            |row| {
                let call_count: i64 = row.get(3)?;
                let error_count: i64 = row.get(4)?;
                Ok(ToolInsight {
                    tool_name: row.get(0)?,
                    server_id: row.get(1)?,
                    server_name: row.get(2)?,
                    call_count,
                    error_count,
                    error_rate: if call_count > 0 {
                        error_count as f64 / call_count as f64
                    } else {
                        0.0
                    },
                    avg_duration_ms: row.get(5)?,
                    p50_ms: None,
                    p95_ms: None,
                    last_called_at: row.get(6)?,
                })
            },
        )?;
        for tool in &mut tools {
            if let Some(values) = durations.get_mut(&(tool.server_id.clone(), tool.tool_name.clone())) {
                values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                tool.p50_ms = percentile_nearest_rank(values, 50.0);
                tool.p95_ms = percentile_nearest_rank(values, 95.0);
            }
        }

        let servers = self.db.query_all(
            &format!(
                "SELECT a.server_id, s.name AS server_name, COUNT(*) AS call_count,
                        COALESCE(SUM(CASE WHEN a.error IS NOT NULL THEN 1 ELSE 0 END), 0) AS error_count,
                        AVG(a.duration_ms) AS avg_duration_ms, MAX(a.timestamp) AS last_called_at
                 FROM audit_logs a LEFT JOIN mcp_servers s ON s.id = a.server_id
                 WHERE a.server_id IS NOT NULL{conditions}
                 GROUP BY a.server_id
                 ORDER BY call_count DESC"
            ),
            &param_refs,
            |row| {
                let call_count: i64 = row.get(2)?;
                let error_count: i64 = row.get(3)?;
                Ok(ServerInsight {
                    server_id: row.get(0)?,
                    server_name: row.get(1)?,
                    call_count,
                    error_count,
                    error_rate: if call_count > 0 {
                        error_count as f64 / call_count as f64
                    } else {
                        0.0
                    },
                    avg_duration_ms: row.get(4)?,
                    last_called_at: row.get(5)?,
                })
            },
        )?;

        Ok(LogInsights {
            total_calls,
            error_calls,
            error_rate,
            avg_duration_ms,
            tools,
            servers,
        })
    }

    pub fn get_stats(&self) -> Result<LogStats, String> {
        let summary = self.db.query_one(
            "SELECT COUNT(*) as total_calls, COALESCE(SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END), 0) as error_calls, AVG(duration_ms) as avg_duration_ms FROM audit_logs",
            &[],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<f64>>(2)?,
                ))
            },
        )?;

        let (total_calls, error_calls, avg_duration_ms) = summary.unwrap_or((0, 0, None));
        let error_rate = if total_calls > 0 {
            error_calls as f64 / total_calls as f64
        } else {
            0.0
        };

        let top_tools = self.db.query_all(
            "SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration FROM audit_logs GROUP BY tool_name ORDER BY count DESC LIMIT 10",
            &[],
            |row| {
                Ok(TopTool {
                    tool_name: row.get(0)?,
                    count: row.get(1)?,
                    avg_duration: row.get(2)?,
                })
            },
        )?;

        let top_servers = self.db.query_all(
            "SELECT server_id, COUNT(*) as count FROM audit_logs WHERE server_id IS NOT NULL GROUP BY server_id ORDER BY count DESC LIMIT 10",
            &[],
            |row| {
                Ok(TopServer {
                    server_id: row.get(0)?,
                    count: row.get(1)?,
                })
            },
        )?;

        Ok(LogStats {
            total_calls,
            error_calls,
            error_rate,
            avg_duration_ms,
            top_tools,
            top_servers,
        })
    }
}
