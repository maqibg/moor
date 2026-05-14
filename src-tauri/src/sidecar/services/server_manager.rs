use crate::sidecar::db::profile_repo::ProfileRepository;
use crate::sidecar::db::server_repo::{Server, ServerRepository};
use crate::sidecar::db::tool_discovery_repo::{ToolDiscoveryRepository, ToolInsert};
use crate::sidecar::db::Database;
use crate::sidecar::mcp::transport::http_client::HttpClientTransport;
use crate::sidecar::mcp::transport::stdio_client::{
    build_stdio_environment, find_executable_on_path, StdioClientTransport,
};
use crate::sidecar::services::event_bus::EventBus;
use crate::sidecar::services::tool_catalog::{ToolCatalogService, ToolDetail};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub struct ManagedServer {
    pub id: String,
    pub name: String,
    pub status: String,
    pub auto_start: bool,
}

enum ServerTransport {
    Stdio(StdioClientTransport),
    Http(HttpClientTransport),
}

struct ServerSession {
    transport: ServerTransport,
}

pub struct ServerManager {
    servers: Arc<Mutex<HashMap<String, ManagedServer>>>,
    sessions: Arc<Mutex<HashMap<String, ServerSession>>>,
    db: Arc<Database>,
    event_bus: Arc<EventBus>,
}

impl ServerManager {
    pub fn new(db: Arc<Database>, event_bus: Arc<EventBus>) -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            db,
            event_bus,
        }
    }

    pub async fn load_from_db(&self) {
        let repo = ServerRepository::new(&self.db);
        let _ = repo.reset_running_statuses();
        let servers = repo.find_all().unwrap_or_default();

        let mut map = self.servers.lock().await;
        map.clear();
        for row in servers {
            map.insert(
                row.id.clone(),
                ManagedServer {
                    id: row.id.clone(),
                    name: row.name.clone(),
                    status: "stopped".to_string(),
                    auto_start: row.auto_start,
                },
            );
        }
    }

    pub async fn get_server(&self, id: &str) -> Option<ManagedServer> {
        self.servers.lock().await.get(id).cloned()
    }

    pub async fn add_server(&self, server: &Server) -> ManagedServer {
        let managed = ManagedServer {
            id: server.id.clone(),
            name: server.name.clone(),
            status: "stopped".to_string(),
            auto_start: server.auto_start,
        };
        self.servers
            .lock()
            .await
            .insert(server.id.clone(), managed.clone());
        managed
    }

    pub async fn remove_server(&self, id: &str) -> bool {
        let server = self.servers.lock().await.get(id).cloned();
        let Some(server) = server else { return false };
        if server.status == "running" {
            self.stop_server(id).await.ok();
        }
        self.sessions.lock().await.remove(id);
        self.servers.lock().await.remove(id);
        let repo = ServerRepository::new(&self.db);
        repo.remove(id).is_ok()
    }

    pub async fn update_server_memory(
        &self,
        id: &str,
        name: Option<&str>,
        auto_start: Option<bool>,
    ) {
        let mut map = self.servers.lock().await;
        if let Some(server) = map.get_mut(id) {
            if let Some(name) = name {
                server.name = name.to_string();
            }
            if let Some(auto_start) = auto_start {
                server.auto_start = auto_start;
            }
        }
    }

    pub async fn start_server(&self, id: &str) -> Result<(), String> {
        let should_wait = {
            let mut servers = self.servers.lock().await;
            let Some(server) = servers.get_mut(id) else {
                return Err(format!("Server {id} not found"));
            };
            match server.status.as_str() {
                "running" => return Ok(()),
                "starting" => true,
                _ => {
                    server.status = "starting".to_string();
                    false
                }
            }
        };

        if should_wait {
            return self.wait_for_start(id).await;
        }

        self.persist_server_status(id, "starting", None);

        let config = self.get_stored_config(id)?;

        let result = match config.connection_type.as_str() {
            "stdio" => self.start_stdio(&config).await,
            "http" => self.start_http(&config).await,
            other => Err(format!("Unknown connection type: {other}")),
        };

        match result {
            Ok((tools, transport)) => {
                self.cache_tools(id, &tools);
                {
                    self.sessions
                        .lock()
                        .await
                        .insert(id.to_string(), ServerSession { transport });
                }
                self.set_server_status(id, "running", None).await;
                Ok(())
            }
            Err(e) => {
                self.sessions.lock().await.remove(id);
                let public_msg = get_public_error_message(&e);
                self.set_server_status(id, "error", Some(&public_msg)).await;
                Err(e)
            }
        }
    }

    async fn wait_for_start(&self, id: &str) -> Result<(), String> {
        for _ in 0..300 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let server = self.servers.lock().await.get(id).cloned();
            match server.as_ref().map(|server| server.status.as_str()) {
                Some("running") => return Ok(()),
                Some("error") => {
                    let repo = ServerRepository::new(&self.db);
                    let message = repo
                        .find_by_id(id)
                        .ok()
                        .flatten()
                        .and_then(|server| server.error_message)
                        .unwrap_or_else(|| {
                            "Server failed to start. Check logs for details.".to_string()
                        });
                    return Err(message);
                }
                Some("starting") => {}
                Some(_) => return Ok(()),
                None => return Err(format!("Server {id} not found")),
            }
        }
        Err(format!("Timed out while waiting for server {id} to start"))
    }

    async fn start_stdio(
        &self,
        config: &StoredServerConfig,
    ) -> Result<(Vec<ToolInsert>, ServerTransport), String> {
        let command = config
            .command
            .as_deref()
            .ok_or("stdio server requires command")?;

        let parent_env: HashMap<String, String> = std::env::vars().collect();
        let server_env = config
            .env
            .as_ref()
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        let env = build_stdio_environment(&parent_env, server_env.as_ref());

        verify_command_available(command, &env)?;

        let args: Vec<String> = config
            .args
            .as_ref()
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let cwd = config.working_dir.as_deref();

        let transport = StdioClientTransport::spawn(command, &args, cwd, env).await?;

        let init_result = transport.send_request("initialize", Some(serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": format!("moor-{}", config.name), "version": env!("CARGO_PKG_VERSION") }
        }))).await?;
        let _ = init_result;
        transport
            .send_notification("notifications/initialized", Some(serde_json::json!({})))
            .await?;

        let tools_result = transport
            .send_request("tools/list", Some(serde_json::json!({})))
            .await?;
        let tools = parse_tools_list(&tools_result);

        Ok((tools, ServerTransport::Stdio(transport)))
    }

    async fn start_http(
        &self,
        config: &StoredServerConfig,
    ) -> Result<(Vec<ToolInsert>, ServerTransport), String> {
        let url = config.url.as_deref().ok_or("http server requires url")?;

        let headers = config
            .headers
            .as_ref()
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let headers =
            crate::sidecar::mcp::transport::http_client::resolve_http_headers(Some(&headers));

        let transport = HttpClientTransport::new(url, headers);

        let init_result = transport.send_request(0, "initialize", Some(serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": format!("moor-{}", config.name), "version": env!("CARGO_PKG_VERSION") }
        }))).await?;
        let _ = init_result;
        transport
            .send_notification("notifications/initialized", Some(serde_json::json!({})))
            .await?;

        let tools_result = transport
            .send_request(1, "tools/list", Some(serde_json::json!({})))
            .await?;
        let tools = parse_tools_list(&tools_result);

        Ok((tools, ServerTransport::Http(transport)))
    }

    pub async fn stop_server(&self, id: &str) -> Result<(), String> {
        let server = self.servers.lock().await.get(id).cloned();
        let Some(server) = server else { return Ok(()) };
        if server.status != "running" {
            return Ok(());
        }

        if let Some(mut session) = self.sessions.lock().await.remove(id) {
            match &mut session.transport {
                ServerTransport::Stdio(t) => t.close().await?,
                ServerTransport::Http(_) => {}
            }
        }
        self.set_server_status(id, "stopped", None).await;
        Ok(())
    }

    pub async fn start_auto_start_servers(&self) {
        let profile_repo = ProfileRepository::new(&self.db);
        let _active_id = match profile_repo.find_active_id() {
            Ok(Some(id)) => id,
            _ => return,
        };
        let server_ids = match profile_repo.find_active_profile_server_ids() {
            Ok(ids) => ids,
            Err(_) => return,
        };

        let servers = self.servers.lock().await;
        let to_start: Vec<String> = server_ids
            .iter()
            .filter_map(|id| {
                servers.get(id).and_then(|s| {
                    if s.auto_start {
                        Some(s.id.clone())
                    } else {
                        None
                    }
                })
            })
            .collect();
        drop(servers);

        for result in
            futures::future::join_all(to_start.iter().map(|id| self.start_server(id))).await
        {
            let _ = result;
        }
    }

    pub async fn call_tool(&self, exposed_name: &str, args: Value) -> Result<Value, String> {
        let catalog = self.get_tool_catalog(None).await;
        let owner = catalog
            .iter()
            .find(|t| t.exposed_name == exposed_name)
            .ok_or_else(|| format!("Tool \"{exposed_name}\" not found or disabled"))?;

        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(&owner.server_id)
            .ok_or_else(|| format!("Server \"{}\" is not running", owner.server_name))?;

        match &session.transport {
            ServerTransport::Stdio(transport) => {
                transport
                    .send_request(
                        "tools/call",
                        Some(serde_json::json!({
                            "name": owner.tool_name,
                            "arguments": args,
                        })),
                    )
                    .await
            }
            ServerTransport::Http(transport) => {
                let id = chrono::Utc::now().timestamp_millis();
                transport
                    .send_request(
                        id,
                        "tools/call",
                        Some(serde_json::json!({
                            "name": owner.tool_name,
                            "arguments": args,
                        })),
                    )
                    .await
            }
        }
    }

    pub async fn get_tool_catalog(
        &self,
        profile_id: Option<&str>,
    ) -> Vec<crate::sidecar::services::tool_catalog::ToolCatalogEntry> {
        let callable_ids = self.get_callable_server_ids().await;
        ToolCatalogService::get_tool_catalog(&self.db, profile_id, Some(&callable_ids))
    }

    pub async fn get_tool_details(
        &self,
        server_id: &str,
        profile_id: Option<&str>,
    ) -> Vec<ToolDetail> {
        let callable_ids = self.get_callable_server_ids().await;
        ToolCatalogService::get_tool_details(&self.db, server_id, profile_id, Some(&callable_ids))
    }

    async fn get_callable_server_ids(&self) -> HashSet<String> {
        let sessions = self.sessions.lock().await;
        let servers = self.servers.lock().await;
        sessions
            .keys()
            .filter(|id| {
                servers
                    .get(*id)
                    .map(|s| s.status == "running")
                    .unwrap_or(false)
            })
            .cloned()
            .collect()
    }

    fn cache_tools(&self, server_id: &str, tools: &[ToolInsert]) {
        let repo = ToolDiscoveryRepository::new(&self.db);
        let _ = repo.replace_tools_for_server(server_id, tools);
        self.event_bus
            .emit("server:tools", serde_json::json!({ "serverId": server_id }));
    }

    async fn set_server_status(&self, id: &str, status: &str, error_message: Option<&str>) {
        {
            let mut map = self.servers.lock().await;
            if let Some(server) = map.get_mut(id) {
                server.status = status.to_string();
            }
        }
        self.persist_server_status(id, status, error_message);
    }

    fn persist_server_status(&self, id: &str, status: &str, error_message: Option<&str>) {
        let repo = ServerRepository::new(&self.db);
        let _ = repo.update_status(id, status, error_message);
        self.event_bus.emit(
            "server:status",
            serde_json::json!({ "serverId": id, "status": status, "errorMessage": error_message }),
        );
    }

    fn get_stored_config(&self, id: &str) -> Result<StoredServerConfig, String> {
        let repo = ServerRepository::new(&self.db);
        let server = repo
            .find_by_id(id)?
            .ok_or_else(|| format!("Server {id} not found"))?;
        Ok(StoredServerConfig {
            name: server.name,
            connection_type: server.connection_type,
            command: server.command,
            args: server.args,
            url: server.url,
            env: server.env,
            headers: server.headers,
            working_dir: server.working_dir,
        })
    }
}

struct StoredServerConfig {
    name: String,
    connection_type: String,
    command: Option<String>,
    args: Option<Value>,
    url: Option<String>,
    env: Option<Value>,
    headers: Option<Value>,
    working_dir: Option<String>,
}

fn parse_tools_list(result: &Value) -> Vec<ToolInsert> {
    result
        .get("tools")
        .and_then(|v| v.as_array())
        .map(|tools| {
            tools
                .iter()
                .map(|tool| ToolInsert {
                    name: tool
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    description: tool
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    input_schema: tool.get("inputSchema").cloned(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn verify_command_available(command: &str, env: &HashMap<String, String>) -> Result<(), String> {
    let path = std::path::Path::new(command);
    if path.is_absolute() {
        if !path.exists() {
            return Err(format!(
                "Command \"{command}\" is not executable while starting this stdio server."
            ));
        }
        return Ok(());
    }
    if find_executable_on_path(command, env).is_none() {
        return Err(format!(
            "Command \"{command}\" was not found on PATH while starting this stdio server."
        ));
    }
    Ok(())
}

fn get_public_error_message(err: &str) -> String {
    if let Some(cmd) = extract_missing_command(err) {
        return format!("Command \"{cmd}\" was not found. Configure an absolute command path or update this server environment.");
    }
    if err.contains("not executable") {
        return "Server failed to start. Check that the command path exists and has execute permission.".to_string();
    }
    "Server failed to start. Check logs for details.".to_string()
}

fn extract_missing_command(err: &str) -> Option<String> {
    let re = regex_lite::Regex::new(r#"Command "([^"]+)" was not found"#).ok()?;
    let caps = re.captures(err)?;
    Some(caps[1].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::db::profile_repo::ProfileRepository;
    use std::time::SystemTime;

    fn temp_data_dir(test_name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moor-server-manager-{test_name}-{timestamp}"))
    }

    fn write_delayed_mcp_server(
        data_dir: &std::path::Path,
        marker: &std::path::Path,
        script_name: &str,
        server_name: &str,
        response_delay_ms: u64,
    ) -> String {
        let script = data_dir.join(script_name);
        std::fs::write(
            &script,
            format!(
                r#"
import fs from "node:fs";
fs.appendFileSync({marker:?}, {server_name:?} + "\n");
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {{
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {{
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.id === undefined) continue;
    setTimeout(() => {{
      let result = {{}};
      if (request.method === "initialize") {{
        result = {{ protocolVersion: "2024-11-05", capabilities: {{ tools: {{}} }}, serverInfo: {{ name: "slow", version: "1.0.0" }} }};
      }} else if (request.method === "tools/list") {{
        result = {{ tools: [{{ name: "echo", description: "Echo", inputSchema: {{ type: "object" }} }}] }};
      }}
      process.stdout.write(JSON.stringify({{ jsonrpc: "2.0", id: request.id, result }}) + "\n");
    }}, {response_delay_ms});
  }}
}});
"#,
                marker = marker.to_string_lossy(),
                server_name = server_name,
                response_delay_ms = response_delay_ms
            ),
        )
        .expect("failed to write delayed MCP server");
        script.to_string_lossy().to_string()
    }

    fn write_slow_mcp_server(data_dir: &std::path::Path, marker: &std::path::Path) -> String {
        write_delayed_mcp_server(data_dir, marker, "slow-mcp-server.mjs", "started", 100)
    }

    fn insert_stdio_server(
        db: &Database,
        id: &str,
        name: &str,
        script: String,
        auto_start: bool,
        sort_order: i64,
    ) {
        let now = chrono::Utc::now().to_rfc3339();
        let args = serde_json::to_string(&vec![script]).expect("failed to serialize args");
        ServerRepository::new(db)
            .insert(
                id,
                name,
                "stdio",
                Some("node"),
                Some(&args),
                None,
                None,
                None,
                None,
                auto_start,
                sort_order,
                &now,
                &now,
            )
            .expect("failed to insert server");
    }

    #[tokio::test]
    async fn concurrent_starts_share_one_start_attempt() {
        let data_dir = temp_data_dir("dedupe-start");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp dir");
        let marker = data_dir.join("starts.log");
        let script = write_slow_mcp_server(&data_dir, &marker);

        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to run migrations");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");

        let server_id = uuid::Uuid::new_v4().to_string();
        insert_stdio_server(&db, &server_id, "slow", script, false, 0);
        profile_repo
            .assign_to_active_profile(std::slice::from_ref(&server_id))
            .expect("failed to assign server");

        let event_bus = Arc::new(EventBus::new(16));
        let manager = Arc::new(ServerManager::new(db, event_bus));
        manager.load_from_db().await;

        let left = {
            let manager = manager.clone();
            let server_id = server_id.clone();
            tokio::spawn(async move { manager.start_server(&server_id).await })
        };
        let right = {
            let manager = manager.clone();
            let server_id = server_id.clone();
            tokio::spawn(async move { manager.start_server(&server_id).await })
        };
        let (left, right) = tokio::join!(left, right);
        left.expect("left task failed").expect("left start failed");
        right
            .expect("right task failed")
            .expect("right start failed");

        let starts = std::fs::read_to_string(&marker).expect("marker should exist");
        assert_eq!(starts.lines().count(), 1);

        manager.stop_server(&server_id).await.expect("stop failed");
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn auto_start_servers_begin_concurrently() {
        let data_dir = temp_data_dir("auto-start-concurrent");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp dir");
        let marker = data_dir.join("starts.log");
        let slow_script =
            write_delayed_mcp_server(&data_dir, &marker, "slow-auto-start.mjs", "slow", 400);
        let fast_script =
            write_delayed_mcp_server(&data_dir, &marker, "fast-auto-start.mjs", "fast", 0);

        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to run migrations");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");

        let slow_id = uuid::Uuid::new_v4().to_string();
        let fast_id = uuid::Uuid::new_v4().to_string();
        insert_stdio_server(&db, &slow_id, "slow", slow_script, true, 0);
        insert_stdio_server(&db, &fast_id, "fast", fast_script, true, 1);
        profile_repo
            .assign_to_active_profile(&[slow_id.clone(), fast_id.clone()])
            .expect("failed to assign servers");

        let event_bus = Arc::new(EventBus::new(16));
        let manager = Arc::new(ServerManager::new(db, event_bus));
        manager.load_from_db().await;

        let auto_start = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.start_auto_start_servers().await })
        };

        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let starts = std::fs::read_to_string(&marker).unwrap_or_default();
        let fast_started_before_slow_completed = starts.lines().any(|line| line == "fast");

        auto_start.await.expect("auto-start task failed");
        manager
            .stop_server(&slow_id)
            .await
            .expect("stop slow failed");
        manager
            .stop_server(&fast_id)
            .await
            .expect("stop fast failed");
        let _ = std::fs::remove_dir_all(data_dir);

        assert!(
            fast_started_before_slow_completed,
            "fast auto-start server should begin before slow server finishes; starts: {starts:?}"
        );
    }
}
