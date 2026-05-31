use super::Database;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub connection_type: String,
    pub status: String,
    pub auto_start: bool,
    pub command: Option<String>,
    pub args: Option<serde_json::Value>,
    pub url: Option<String>,
    pub env: Option<serde_json::Value>,
    pub headers: Option<serde_json::Value>,
    pub working_dir: Option<String>,
    pub error_message: Option<String>,
    pub sort_order: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

pub(crate) fn map_server(row: &rusqlite::Row<'_>) -> rusqlite::Result<Server> {
    let args_str: Option<String> = row.get("args")?;
    let env_str: Option<String> = row.get("env")?;
    let headers_str: Option<String> = row.get("headers")?;
    let auto_start: i64 = row.get("auto_start")?;
    let sort_order: i64 = row.get("sort_order")?;

    Ok(Server {
        id: row.get("id")?,
        name: row.get("name")?,
        connection_type: row.get("connection_type")?,
        status: row.get("status")?,
        auto_start: auto_start != 0,
        command: row.get("command")?,
        args: args_str
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .or_else(|| Some(serde_json::Value::Array(vec![]))),
        url: row.get("url")?,
        env: env_str.and_then(|s| serde_json::from_str(&s).ok()),
        headers: headers_str.and_then(|s| serde_json::from_str(&s).ok()),
        working_dir: row.get("working_dir")?,
        error_message: row.get("error_message")?,
        sort_order: if sort_order == 0 {
            Some(0)
        } else {
            Some(sort_order)
        },
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub struct ServerRepository<'a> {
    pub db: &'a Database,
}

impl<'a> ServerRepository<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn find_all(&self) -> Result<Vec<Server>, String> {
        self.db.query_all(
            "SELECT * FROM mcp_servers ORDER BY sort_order ASC, created_at DESC",
            &[],
            map_server,
        )
    }

    pub fn find_all_names(&self) -> Result<Vec<(String, String)>, String> {
        self.db.query_all(
            "SELECT id, name FROM mcp_servers ORDER BY name ASC",
            &[],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    pub fn find_ids(&self) -> Result<Vec<String>, String> {
        self.db
            .query_all("SELECT id FROM mcp_servers", &[], |row| row.get(0))
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<Server>, String> {
        self.db.query_one(
            "SELECT * FROM mcp_servers WHERE id = ?1",
            &[&id],
            map_server,
        )
    }

    pub fn find_by_ids(&self, ids: &[String]) -> Result<Vec<Server>, String> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let unique: Vec<String> = ids
            .iter()
            .cloned()
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        let mut all_rows = Vec::new();
        for chunk in unique.chunks(500) {
            let placeholders: Vec<String> = (1..=chunk.len()).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "SELECT * FROM mcp_servers WHERE id IN ({})",
                placeholders.join(",")
            );
            let params: Vec<&dyn rusqlite::types::ToSql> = chunk
                .iter()
                .map(|s| s as &dyn rusqlite::types::ToSql)
                .collect();
            let rows = self.db.query_all(&sql, &params, map_server)?;
            all_rows.extend(rows);
        }
        let by_id: std::collections::HashMap<String, Server> =
            all_rows.into_iter().map(|s| (s.id.clone(), s)).collect();
        Ok(ids.iter().filter_map(|id| by_id.get(id).cloned()).collect())
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub fn insert(
        &self,
        id: &str,
        name: &str,
        connection_type: &str,
        command: Option<&str>,
        args: Option<&str>,
        url: Option<&str>,
        env: Option<&str>,
        headers: Option<&str>,
        working_dir: Option<&str>,
        auto_start: bool,
        sort_order: i64,
        created_at: &str,
        updated_at: &str,
    ) -> Result<(), String> {
        self.db.run(
            "INSERT INTO mcp_servers (id, name, connection_type, command, args, url, env, headers, working_dir, auto_start, sort_order, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'stopped', ?12, ?13)",
            &[&id, &name, &connection_type, &command, &args, &url, &env, &headers, &working_dir, &(auto_start as i64), &sort_order, &created_at, &updated_at],
        )
    }

    pub fn update(
        &self,
        id: &str,
        set_clauses: &str,
        params: &[&dyn rusqlite::types::ToSql],
    ) -> Result<(), String> {
        let sql = format!("UPDATE mcp_servers SET {set_clauses} WHERE id = ?");
        let mut all_params: Vec<&dyn rusqlite::types::ToSql> = params.to_vec();
        all_params.push(&id);
        self.db.run(&sql, &all_params)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        self.db.transaction(|conn| {
            conn.execute(
                "UPDATE audit_logs SET server_id = NULL WHERE server_id = ?1",
                [id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM mcp_servers WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn reorder(&self, ids: &[String]) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.transaction(|conn| {
            for (index, id) in ids.iter().enumerate() {
                conn.execute(
                    "UPDATE mcp_servers SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![index as i64, &now, id],
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        })
    }

    pub fn update_status(
        &self,
        id: &str,
        status: &str,
        error_message: Option<&str>,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.run(
            "UPDATE mcp_servers SET status = ?1, error_message = ?2, updated_at = ?3 WHERE id = ?4",
            &[&status, &error_message, &now, &id],
        )
    }

    pub fn reset_running_statuses(&self) -> Result<(), String> {
        self.db.run(
            "UPDATE mcp_servers SET status = 'stopped', error_message = NULL WHERE status IN ('running', 'starting')",
            &[],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    fn temp_db() -> Database {
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("moor-server-repo-{ts}.db"));
        let db = Database::open(&path).expect("open db");
        db.run_migrations().expect("migrate");
        db
    }

    #[test]
    fn find_by_ids_preserves_requested_order_and_skips_missing() {
        let db = temp_db();
        let repo = ServerRepository::new(&db);
        let now = "2026-01-01T00:00:00.000Z";
        repo.insert(
            "first",
            "first",
            "stdio",
            Some("node"),
            None,
            None,
            None,
            None,
            None,
            false,
            0,
            now,
            now,
        )
        .expect("insert first");
        repo.insert(
            "second",
            "second",
            "stdio",
            Some("node"),
            None,
            None,
            None,
            None,
            None,
            false,
            1,
            now,
            now,
        )
        .expect("insert second");

        let rows = repo
            .find_by_ids(&[
                "second".to_string(),
                "missing".to_string(),
                "first".to_string(),
            ])
            .expect("find_by_ids");

        assert_eq!(
            rows.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["second", "first"]
        );
    }
}
