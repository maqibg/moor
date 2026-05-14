use crate::sidecar::db::profile_repo::ProfileRepository;
use crate::sidecar::db::server_repo::{Server, ServerRepository};
use crate::sidecar::db::tool_discovery_repo::{ToolDiscoveryRepository, ToolInsert};
use crate::sidecar::db::Database;
use crate::sidecar::mcp::transport::http_client::HttpClientTransport;
use crate::sidecar::mcp::transport::stdio_client::{
    build_stdio_environment, find_executable_on_path, StdioClientTransport,
};
use crate::sidecar::services::event_bus::EventBus;
use crate::sidecar::services::tool_catalog::ToolCatalogService;
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
        let server = self.servers.lock().await.get(id).cloned();
        let Some(server) = server else {
            return Err(format!("Server {id} not found"));
        };
        if server.status == "running" {
            return Ok(());
        }

        self.set_server_status(id, "starting", None).await;

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

        for id in to_start {
            let _ = self.start_server(&id).await;
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
