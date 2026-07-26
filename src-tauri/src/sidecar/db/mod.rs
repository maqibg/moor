pub mod audit_log_repo;
mod migrations;
pub mod profile_repo;
pub mod server_repo;
pub mod settings_repo;
pub mod tool_discovery_repo;

use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use std::sync::{
    atomic::{AtomicU64, AtomicUsize, Ordering},
    Mutex,
};

const READ_POOL_SIZE: usize = 4;
const STATEMENT_CACHE_CAPACITY: usize = 64;
static NEXT_MEMORY_DATABASE_ID: AtomicU64 = AtomicU64::new(0);

pub struct Database {
    writer: Mutex<Connection>,
    readers: Vec<Mutex<Connection>>,
    next_reader: AtomicUsize,
}

impl Database {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let memory_uri = (db_path == Path::new(":memory:")).then(|| {
            let id = NEXT_MEMORY_DATABASE_ID.fetch_add(1, Ordering::Relaxed);
            format!(
                "file:moor-memory-{}-{id}?mode=memory&cache=shared",
                std::process::id()
            )
        });
        let open_connection = || match memory_uri.as_deref() {
            Some(uri) => Connection::open_with_flags(
                uri,
                OpenFlags::SQLITE_OPEN_READ_WRITE
                    | OpenFlags::SQLITE_OPEN_CREATE
                    | OpenFlags::SQLITE_OPEN_URI,
            ),
            None => Connection::open(db_path),
        };

        let writer = open_connection().map_err(|e| e.to_string())?;
        configure_connection(&writer, false)?;
        let mut readers = Vec::with_capacity(READ_POOL_SIZE);
        for _ in 0..READ_POOL_SIZE {
            let reader = open_connection().map_err(|e| e.to_string())?;
            configure_connection(&reader, true)?;
            readers.push(Mutex::new(reader));
        }
        Ok(Self {
            writer: Mutex::new(writer),
            readers,
            next_reader: AtomicUsize::new(0),
        })
    }

    pub fn run(&self, sql: &str, params: &[&dyn rusqlite::types::ToSql]) -> Result<(), String> {
        let conn = self.writer.lock().map_err(|e| e.to_string())?;
        conn.execute(sql, params).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn exec(&self, sql: &str) -> Result<(), String> {
        let conn = self.writer.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(sql).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn query_one<F, T>(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::types::ToSql],
        map_row: F,
    ) -> Result<Option<T>, String>
    where
        F: FnOnce(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    {
        let conn = self.read_connection()?;
        let mut stmt = conn.prepare_cached(sql).map_err(|e| e.to_string())?;
        match stmt.query_row(params, map_row) {
            Ok(row) => Ok(Some(row)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn query_all<F, T>(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::types::ToSql],
        map_row: F,
    ) -> Result<Vec<T>, String>
    where
        F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    {
        let conn = self.read_connection()?;
        let mut stmt = conn.prepare_cached(sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params, map_row).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Execute a function inside a transaction. The closure receives `&Connection`
    /// with the lock held for the entire transaction scope.
    pub fn transaction<T, F>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, String>,
    {
        let guard = self.writer.lock().map_err(|e| e.to_string())?;
        guard
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        match f(&guard) {
            Ok(result) => {
                guard.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                Ok(result)
            }
            Err(e) => {
                guard
                    .execute_batch("ROLLBACK")
                    .map_err(|e2| format!("{e}; rollback: {e2}"))?;
                Err(e)
            }
        }
    }

    pub fn run_migrations(&self) -> Result<(), String> {
        migrations::run_migrations(self)
    }

    pub fn incremental_vacuum(&self, pages: u32) -> Result<(), String> {
        self.exec(&format!(
            "PRAGMA wal_checkpoint(PASSIVE); PRAGMA incremental_vacuum({pages});"
        ))
    }

    pub fn ensure_incremental_auto_vacuum(&self) -> Result<(), String> {
        let connection = self.writer.lock().map_err(|error| error.to_string())?;
        let mode = connection
            .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, i64>(0))
            .map_err(|error| error.to_string())?;
        if mode == 2 {
            return Ok(());
        }
        connection
            .execute_batch("PRAGMA auto_vacuum = INCREMENTAL; VACUUM")
            .map_err(|error| error.to_string())
    }

    fn read_connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        let index = self.next_reader.fetch_add(1, Ordering::Relaxed) % self.readers.len();
        self.readers[index].lock().map_err(|e| e.to_string())
    }
}

fn configure_connection(conn: &Connection, query_only: bool) -> Result<(), String> {
    conn.set_prepared_statement_cache_capacity(STATEMENT_CACHE_CAPACITY);
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA auto_vacuum = INCREMENTAL;",
    )
    .map_err(|e| e.to_string())?;
    if query_only {
        conn.execute_batch("PRAGMA query_only = ON")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Database;
    use std::path::Path;
    use std::time::SystemTime;

    #[test]
    fn memory_database_connections_share_state() {
        let db = Database::open(Path::new(":memory:")).expect("open in-memory database");
        db.exec("CREATE TABLE shared_state (value TEXT NOT NULL);")
            .expect("create table");
        db.run(
            "INSERT INTO shared_state (value) VALUES (?1)",
            &[&"visible"],
        )
        .expect("insert value");

        for _ in 0..4 {
            let value = db
                .query_one("SELECT value FROM shared_state", &[], |row| {
                    row.get::<_, String>(0)
                })
                .expect("query value");
            assert_eq!(value.as_deref(), Some("visible"));
        }
    }

    #[test]
    fn existing_database_can_enable_incremental_auto_vacuum() {
        let suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time should follow the unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("moor-auto-vacuum-{suffix}.db"));
        let connection = rusqlite::Connection::open(&path).expect("create legacy database");
        connection
            .execute_batch("CREATE TABLE legacy (id INTEGER PRIMARY KEY);")
            .expect("create legacy schema");
        drop(connection);

        let db = Database::open(&path).expect("open legacy database");
        db.ensure_incremental_auto_vacuum()
            .expect("enable incremental auto vacuum");
        let mode = db
            .writer
            .lock()
            .expect("lock writer")
            .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, i64>(0))
            .expect("read auto vacuum mode");
        assert_eq!(mode, 2);

        drop(db);
        let _ = std::fs::remove_file(path);
    }
}
