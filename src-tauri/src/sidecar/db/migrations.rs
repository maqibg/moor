use super::Database;

pub fn run_migrations(db: &Database) -> Result<(), String> {
    db.exec(
        "CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mcp_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            connection_type TEXT NOT NULL CHECK(connection_type IN ('stdio', 'http')),
            command TEXT,
            args TEXT,
            url TEXT,
            env TEXT,
            headers TEXT,
            working_dir TEXT,
            auto_start INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('stopped', 'starting', 'running', 'error')),
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS profile_servers (
            profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
            enabled INTEGER NOT NULL DEFAULT 1,
            disabled_tools TEXT NOT NULL DEFAULT '[]',
            PRIMARY KEY (profile_id, server_id)
        );

        CREATE TABLE IF NOT EXISTS tool_discoveries (
            server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
            tool_name TEXT NOT NULL,
            exposed_name TEXT NOT NULL,
            description TEXT,
            input_schema TEXT,
            discovered_at TEXT NOT NULL,
            PRIMARY KEY (server_id, tool_name)
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            profile_id TEXT REFERENCES profiles(id),
            server_id TEXT REFERENCES mcp_servers(id),
            tool_name TEXT NOT NULL,
            arguments TEXT,
            result TEXT,
            error TEXT,
            duration_ms INTEGER,
            agent_info TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_tool_name ON audit_logs(tool_name);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_server_id ON audit_logs(server_id);
        CREATE INDEX IF NOT EXISTS idx_tool_discoveries_server_id ON tool_discoveries(server_id);
        CREATE INDEX IF NOT EXISTS idx_tool_discoveries_exposed_name ON tool_discoveries(exposed_name);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )?;

    ensure_column(db, "tool_discoveries", "exposed_name", "TEXT")?;
    ensure_column(db, "mcp_servers", "headers", "TEXT")?;
    ensure_column(
        db,
        "mcp_servers",
        "auto_start",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        db,
        "mcp_servers",
        "sort_order",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    backfill_server_sort_order(db)?;

    Ok(())
}

fn ensure_column(db: &Database, table: &str, column: &str, definition: &str) -> Result<(), String> {
    let all_cols = db.query_all(&format!("PRAGMA table_info({table})"), &[], |row| {
        row.get::<_, String>(1)
    })?;
    if all_cols.iter().any(|c| c == column) {
        return Ok(());
    }
    db.run(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        &[],
    )
}

fn backfill_server_sort_order(db: &Database) -> Result<(), String> {
    let rows = db.query_all(
        "SELECT id, sort_order FROM mcp_servers ORDER BY created_at DESC, id ASC",
        &[],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    )?;
    if rows.len() <= 1 {
        return Ok(());
    }
    let needs_backfill = rows
        .iter()
        .map(|(_, o)| *o)
        .collect::<std::collections::HashSet<_>>()
        .len()
        == 1;
    if !needs_backfill {
        return Ok(());
    }
    db.transaction(|conn| {
        for (index, (id, _)) in rows.iter().enumerate() {
            conn.execute(
                "UPDATE mcp_servers SET sort_order = ?1 WHERE id = ?2",
                rusqlite::params![&(index as i64), id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}
