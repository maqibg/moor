use crate::sidecar::db::profile_repo::ProfileRepository;
use crate::sidecar::db::server_repo::{Server, ServerRepository};
use crate::sidecar::db::tool_discovery_repo::{ToolDiscoveryRepository, ToolInsert};
use crate::sidecar::db::Database;
use crate::sidecar::mcp::transport::mcp_client::{
    HttpConnectConfig, McpClient, StdioConnectConfig,
};
use crate::sidecar::mcp::transport::stdio_client::{
    build_stdio_environment, find_executable_on_path,
};
use crate::sidecar::services::event_bus::EventBus;
use crate::sidecar::services::settings;
use crate::sidecar::services::tool_catalog::{ToolCatalogService, ToolDetail};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

#[derive(Clone)]
struct ServerSlot {
    name: String,
    status: ServerStatus,
    auto_start: bool,
    start_token: u64,
    session: Option<Arc<tokio::sync::Mutex<McpClient>>>,
}

#[derive(Debug, Clone)]
enum ServerStatus {
    Stopped,
    Starting,
    Running,
    Error(String),
}

impl ServerStatus {
    fn as_str(&self) -> &str {
        match self {
            ServerStatus::Stopped => "stopped",
            ServerStatus::Starting => "starting",
            ServerStatus::Running => "running",
            ServerStatus::Error(_) => "error",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ManagedServer {
    pub status: String,
}

pub struct ServerManager {
    slots: Arc<Mutex<HashMap<String, ServerSlot>>>,
    db: Arc<Database>,
    event_bus: Arc<EventBus>,
}

#[derive(Clone, Copy)]
struct ServerTimeouts {
    request_ms: u32,
    start_ms: u32,
}

impl ServerTimeouts {
    fn startup_request_ms(self) -> u32 {
        self.request_ms.max(self.start_ms)
    }
}

impl ServerManager {
    pub fn new(db: Arc<Database>, event_bus: Arc<EventBus>) -> Self {
        Self {
            slots: Arc::new(Mutex::new(HashMap::new())),
            db,
            event_bus,
        }
    }

    pub async fn load_from_db(&self) {
        let repo = ServerRepository::new(&self.db);
        let _ = repo.reset_running_statuses();
        let servers = repo.find_all().unwrap_or_default();

        let mut map = self.slots.lock().await;
        map.clear();
        for row in servers {
            map.insert(
                row.id.clone(),
                ServerSlot {
                    name: row.name.clone(),
                    status: ServerStatus::Stopped,
                    auto_start: row.auto_start,
                    start_token: 0,
                    session: None,
                },
            );
        }
    }

    pub async fn get_server(&self, id: &str) -> Option<ManagedServer> {
        let slots = self.slots.lock().await;
        slots.get(id).map(|s| ManagedServer {
            status: s.status.as_str().to_string(),
        })
    }

    pub async fn add_server(&self, server: &Server) -> ManagedServer {
        let managed = ManagedServer {
            status: "stopped".to_string(),
        };
        self.slots.lock().await.insert(
            server.id.clone(),
            ServerSlot {
                name: server.name.clone(),
                status: ServerStatus::Stopped,
                auto_start: server.auto_start,
                start_token: 0,
                session: None,
            },
        );
        managed
    }

    pub async fn remove_server(&self, id: &str) -> bool {
        let should_stop = {
            let slots = self.slots.lock().await;
            slots
                .get(id)
                .map(|s| matches!(s.status, ServerStatus::Running | ServerStatus::Starting))
                .unwrap_or(false)
        };
        if should_stop {
            self.stop_server(id).await.ok();
        }
        self.slots.lock().await.remove(id);
        let tool_repo = ToolDiscoveryRepository::new(&self.db);
        let _ = tool_repo.delete_by_server_id(id);
        let repo = ServerRepository::new(&self.db);
        repo.remove(id).is_ok()
    }

    pub async fn update_server_memory(
        &self,
        id: &str,
        name: Option<&str>,
        auto_start: Option<bool>,
    ) {
        let mut slots = self.slots.lock().await;
        if let Some(slot) = slots.get_mut(id) {
            if let Some(name) = name {
                slot.name = name.to_string();
            }
            if let Some(auto_start) = auto_start {
                slot.auto_start = auto_start;
            }
        }
    }

    pub async fn start_server(&self, id: &str) -> Result<(), String> {
        let (should_wait, start_token) = {
            let mut slots = self.slots.lock().await;
            let Some(slot) = slots.get_mut(id) else {
                return Err(format!("Server {id} not found"));
            };
            match &slot.status {
                ServerStatus::Running => return Ok(()),
                ServerStatus::Starting => (true, slot.start_token),
                _ => {
                    slot.status = ServerStatus::Starting;
                    slot.start_token = slot.start_token.wrapping_add(1);
                    (false, slot.start_token)
                }
            }
        };

        let timeouts = self.get_timeout_settings();

        if should_wait {
            return self.wait_for_start(id, timeouts.start_ms).await;
        }

        self.persist_server_status(id, "starting", None);

        let result =
            match tokio::time::timeout(Duration::from_millis(timeouts.start_ms as u64), async {
                match self.get_stored_config(id) {
                    Ok(config) => match config.connection_type.as_str() {
                        "stdio" => self.connect_stdio(&config, timeouts).await,
                        "http" => self.connect_http(&config, timeouts).await,
                        other => Err(format!("Unknown connection type: {other}")),
                    },
                    Err(err) => Err(err),
                }
            })
            .await
            {
                Ok(result) => result,
                Err(_) => Err(format!(
                    "Server start timed out after {}",
                    format_timeout_ms(timeouts.start_ms)
                )),
            };

        match result {
            Ok((tools, client)) => {
                let alive_rx = client.alive_receiver();
                let mut client = Some(client);
                let accepted = {
                    let mut slots = self.slots.lock().await;
                    if let Some(slot) = slots.get_mut(id) {
                        if matches!(slot.status, ServerStatus::Starting)
                            && slot.start_token == start_token
                        {
                            slot.status = ServerStatus::Running;
                            let client = client
                                .take()
                                .expect("client should be available before session is accepted");
                            slot.session = Some(Arc::new(tokio::sync::Mutex::new(client)));
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                };
                if !accepted {
                    if let Some(mut client) = client {
                        let _ = client.disconnect().await;
                    }
                    return Ok(());
                }
                self.cache_tools(id, &tools);
                self.persist_server_status(id, "running", None);
                self.spawn_death_watcher(id.to_string(), start_token, alive_rx);
                Ok(())
            }
            Err(e) => {
                let public_msg = public_server_start_error_message(&e);
                let should_persist = {
                    let mut slots = self.slots.lock().await;
                    if let Some(slot) = slots.get_mut(id) {
                        if matches!(slot.status, ServerStatus::Starting)
                            && slot.start_token == start_token
                        {
                            slot.status = ServerStatus::Error(public_msg.clone());
                            slot.session = None;
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                };
                if should_persist {
                    self.persist_server_status(id, "error", Some(&public_msg));
                    Err(e)
                } else {
                    Ok(())
                }
            }
        }
    }

    async fn wait_for_start(&self, id: &str, start_timeout_ms: u32) -> Result<(), String> {
        let timeout_ms = start_timeout_ms.saturating_add(1_000);
        let poll_count = timeout_ms.div_ceil(100);
        for _ in 0..poll_count {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let slots = self.slots.lock().await;
            match slots.get(id) {
                Some(slot) => match &slot.status {
                    ServerStatus::Running => return Ok(()),
                    ServerStatus::Error(msg) => return Err(msg.clone()),
                    ServerStatus::Starting => {}
                    _ => return Ok(()),
                },
                None => return Err(format!("Server {id} not found")),
            }
        }
        Err(format!(
            "Server start wait timed out after {}",
            format_timeout_ms(timeout_ms)
        ))
    }

    async fn connect_stdio(
        &self,
        config: &StoredServerConfig,
        timeouts: ServerTimeouts,
    ) -> Result<(Vec<ToolInsert>, McpClient), String> {
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

        let mut client = McpClient::connect_stdio(StdioConnectConfig {
            server_name: config.name.clone(),
            command: command.to_string(),
            args,
            cwd: config.working_dir.clone(),
            env,
            request_timeout_ms: timeouts.startup_request_ms(),
        })
        .await?;

        let tools = client.list_tools().await?;
        client.set_request_timeout_ms(timeouts.request_ms);

        Ok((tools, client))
    }

    async fn connect_http(
        &self,
        config: &StoredServerConfig,
        timeouts: ServerTimeouts,
    ) -> Result<(Vec<ToolInsert>, McpClient), String> {
        let url = config.url.as_deref().ok_or("http server requires url")?;

        let headers = config
            .headers
            .as_ref()
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let env = config
            .env
            .as_ref()
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let headers = crate::sidecar::mcp::transport::http_client::resolve_http_headers(
            Some(&headers),
            Some(&env),
        );

        let mut client = McpClient::connect_http(HttpConnectConfig {
            server_name: config.name.clone(),
            url: url.to_string(),
            headers,
            request_timeout_ms: timeouts.startup_request_ms(),
        })
        .await?;

        let tools = client.list_tools().await?;
        client.set_request_timeout_ms(timeouts.request_ms);

        Ok((tools, client))
    }

    pub async fn stop_server(&self, id: &str) -> Result<(), String> {
        let old_session = {
            let mut slots = self.slots.lock().await;
            let Some(slot) = slots.get_mut(id) else {
                return Ok(());
            };
            if !matches!(slot.status, ServerStatus::Running | ServerStatus::Starting) {
                return Ok(());
            }
            slot.status = ServerStatus::Stopped;
            slot.start_token = slot.start_token.wrapping_add(1);
            slot.session.take()
        };

        if let Some(session) = old_session {
            let mut client = session.lock().await;
            let _ = client.disconnect().await;
        }
        self.persist_server_status(id, "stopped", None);
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

        let slots = self.slots.lock().await;
        let to_start: Vec<String> = server_ids
            .iter()
            .filter_map(|id| {
                slots
                    .get(id)
                    .and_then(|s| if s.auto_start { Some(id.clone()) } else { None })
            })
            .collect();
        drop(slots);

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

        let session_arc = {
            let slots = self.slots.lock().await;
            let slot = slots
                .get(&owner.server_id)
                .ok_or_else(|| format!("Server \"{}\" is not running", owner.server_name))?;
            slot.session
                .clone()
                .ok_or_else(|| format!("Server \"{}\" is not running", owner.server_name))
        }?;

        let client = session_arc.lock().await;
        client.call_tool(&owner.tool_name, args).await
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
        let slots = self.slots.lock().await;
        slots
            .iter()
            .filter(|(_, s)| matches!(s.status, ServerStatus::Running))
            .map(|(id, _)| id.clone())
            .collect()
    }

    fn spawn_death_watcher(
        &self,
        server_id: String,
        start_token: u64,
        alive_rx: Option<tokio::sync::watch::Receiver<bool>>,
    ) {
        let Some(mut rx) = alive_rx else { return };
        let slots = self.slots.clone();
        let db = self.db.clone();
        let event_bus = self.event_bus.clone();

        tokio::spawn(async move {
            while rx.changed().await.is_ok() {
                if !*rx.borrow_and_update() {
                    let msg = "Server process exited unexpectedly".to_string();
                    {
                        let mut slots = slots.lock().await;
                        if let Some(slot) = slots.get_mut(&server_id) {
                            if matches!(slot.status, ServerStatus::Running)
                                && slot.start_token == start_token
                            {
                                slot.status = ServerStatus::Error(msg.clone());
                                slot.session = None;
                            } else {
                                return;
                            }
                        } else {
                            return;
                        }
                    }
                    let repo = ServerRepository::new(&db);
                    let _ = repo.update_status(&server_id, "error", Some(&msg));
                    event_bus.emit(
                        "server:status",
                        serde_json::json!({ "serverId": server_id, "status": "error", "errorMessage": msg }),
                    );
                    return;
                }
            }
        });
    }

    fn cache_tools(&self, server_id: &str, tools: &[ToolInsert]) {
        let repo = ToolDiscoveryRepository::new(&self.db);
        let _ = repo.replace_tools_for_server(server_id, tools);
        self.event_bus
            .emit("server:tools", serde_json::json!({ "serverId": server_id }));
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

    fn get_timeout_settings(&self) -> ServerTimeouts {
        settings::get_settings(&self.db)
            .map(|settings| ServerTimeouts {
                request_ms: settings.advanced.mcp_request_timeout_ms,
                start_ms: settings.advanced.mcp_server_start_timeout_ms,
            })
            .unwrap_or(ServerTimeouts {
                request_ms: settings::MCP_TIMEOUT_MS_DEFAULT,
                start_ms: settings::MCP_TIMEOUT_MS_DEFAULT,
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

pub fn public_server_start_error_message(err: &str) -> String {
    if let Some(cmd) = extract_missing_command(err) {
        return format!("Command \"{cmd}\" was not found. Configure an absolute command path or update this server environment.");
    }
    if err.contains("not executable") {
        return "Server failed to start. Check that the command path exists and has execute permission.".to_string();
    }
    if let Some(summary) = extract_stdio_stderr_summary(err) {
        return format!("Server failed to start: {summary}");
    }
    "Server failed to start. Check logs for details.".to_string()
}

fn format_timeout_ms(timeout_ms: u32) -> String {
    if timeout_ms % 1000 == 0 {
        format!("{}s", timeout_ms / 1000)
    } else {
        format!("{timeout_ms}ms")
    }
}

fn extract_missing_command(err: &str) -> Option<String> {
    let re = regex_lite::Regex::new(r#"Command "([^"]+)" was not found"#).ok()?;
    let caps = re.captures(err)?;
    Some(caps[1].to_string())
}

fn extract_stdio_stderr_summary(err: &str) -> Option<&str> {
    err.split_once(". stdio stderr: ")
        .map(|(_, summary)| summary.trim())
        .filter(|summary| !summary.is_empty())
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

    fn write_phase_delay_mcp_server(
        data_dir: &std::path::Path,
        marker: &std::path::Path,
        script_name: &str,
        server_name: &str,
        initialize_delay_ms: u64,
        list_tools_delay_ms: u64,
        tool_call_delay_ms: u64,
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
    const delays = {{
      initialize: {initialize_delay_ms},
      "tools/list": {list_tools_delay_ms},
      "tools/call": {tool_call_delay_ms},
    }};
    setTimeout(() => {{
      let result = {{}};
      if (request.method === "initialize") {{
        result = {{ protocolVersion: "2024-11-05", capabilities: {{ tools: {{}} }}, serverInfo: {{ name: "phase", version: "1.0.0" }} }};
      }} else if (request.method === "tools/list") {{
        result = {{ tools: [{{ name: "echo", description: "Echo", inputSchema: {{ type: "object" }} }}] }};
      }} else if (request.method === "tools/call") {{
        result = {{ content: [{{ type: "text", text: "ok" }}] }};
      }}
      process.stdout.write(JSON.stringify({{ jsonrpc: "2.0", id: request.id, result }}) + "\n");
    }}, delays[request.method] ?? 0);
  }}
}});
"#,
                marker = marker.to_string_lossy(),
                server_name = server_name,
                initialize_delay_ms = initialize_delay_ms,
                list_tools_delay_ms = list_tools_delay_ms,
                tool_call_delay_ms = tool_call_delay_ms
            ),
        )
        .expect("failed to write phase-delay MCP server");
        script.to_string_lossy().to_string()
    }

    fn write_slow_mcp_server(data_dir: &std::path::Path, marker: &std::path::Path) -> String {
        write_delayed_mcp_server(data_dir, marker, "slow-mcp-server.mjs", "started", 100)
    }

    fn write_client_info_mcp_server(
        data_dir: &std::path::Path,
        marker: &std::path::Path,
    ) -> String {
        let script = data_dir.join("client-info-mcp-server.mjs");
        std::fs::write(
            &script,
            format!(
                r#"
import fs from "node:fs";
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {{
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {{
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {{
      fs.appendFileSync({marker:?}, request.params?.clientInfo?.name + "\n");
      process.stdout.write(JSON.stringify({{ jsonrpc: "2.0", id: request.id, result: {{ protocolVersion: "2024-11-05", capabilities: {{ tools: {{}} }}, serverInfo: {{ name: "client-info", version: "1.0.0" }} }} }}) + "\n");
    }} else if (request.method === "tools/list") {{
      process.stdout.write(JSON.stringify({{ jsonrpc: "2.0", id: request.id, result: {{ tools: [] }} }}) + "\n");
    }}
  }}
}});
"#,
                marker = marker.to_string_lossy()
            ),
        )
        .expect("failed to write client-info MCP server");
        script.to_string_lossy().to_string()
    }

    fn write_erroring_mcp_server(
        data_dir: &std::path::Path,
        marker: &std::path::Path,
        script_name: &str,
        server_name: &str,
        failing_method: &str,
        response_delay_ms: u64,
        startup_stderr: Option<&str>,
    ) -> String {
        let script = data_dir.join(script_name);
        let startup_stderr = startup_stderr
            .map(|line| format!("console.error({line:?});"))
            .unwrap_or_default();
        std::fs::write(
            &script,
            format!(
                r#"
import fs from "node:fs";
fs.appendFileSync({marker:?}, {server_name:?} + "\n");
{startup_stderr}
const failingMethod = {failing_method:?};
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
      let payload = {{ result: {{}} }};
      if (request.method === failingMethod) {{
        payload = {{ error: {{ code: -32000, message: request.method + " failed" }} }};
      }} else if (request.method === "initialize") {{
        payload = {{ result: {{ protocolVersion: "2024-11-05", capabilities: {{ tools: {{}} }}, serverInfo: {{ name: "erroring", version: "1.0.0" }} }} }};
      }} else if (request.method === "tools/list") {{
        payload = {{ result: {{ tools: [{{ name: "echo", description: "Echo", inputSchema: {{ type: "object" }} }}] }} }};
      }}
      process.stdout.write(JSON.stringify({{ jsonrpc: "2.0", id: request.id, ...payload }}) + "\n");
      if (request.method === failingMethod) setTimeout(() => process.exit(1), 20);
    }}, {response_delay_ms});
  }}
}});
"#,
                marker = marker.to_string_lossy(),
                server_name = server_name,
                startup_stderr = startup_stderr,
                failing_method = failing_method,
                response_delay_ms = response_delay_ms
            ),
        )
        .expect("failed to write erroring MCP server");
        script.to_string_lossy().to_string()
    }

    #[test]
    fn public_error_prefers_stdio_stderr_summary() {
        assert_eq!(
            public_server_start_error_message(
                "request timed out after 30s. stdio stderr: npm ERR! package not found"
            ),
            "Server failed to start: npm ERR! package not found"
        );
    }

    #[test]
    fn public_error_falls_back_without_stdio_stderr_summary() {
        assert_eq!(
            public_server_start_error_message("request timed out after 30s"),
            "Server failed to start. Check logs for details."
        );
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
    async fn startup_uses_larger_start_timeout_then_restores_request_timeout() {
        let data_dir = temp_data_dir("startup-request-timeout");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp dir");
        let marker = data_dir.join("starts.log");
        let script = write_phase_delay_mcp_server(
            &data_dir,
            &marker,
            "phase-delay.mjs",
            "phase",
            5_500,
            0,
            5_500,
        );

        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to run migrations");
        settings::update_settings(
            &db,
            serde_json::json!({
                "advanced": {
                    "mcpRequestTimeoutMs": settings::MCP_TIMEOUT_MS_MIN,
                    "mcpServerStartTimeoutMs": 7_000
                }
            }),
        )
        .expect("settings update should succeed");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");

        let server_id = uuid::Uuid::new_v4().to_string();
        insert_stdio_server(&db, &server_id, "phase", script, false, 0);
        profile_repo
            .assign_to_active_profile(std::slice::from_ref(&server_id))
            .expect("failed to assign server");

        let event_bus = Arc::new(EventBus::new(16));
        let manager = Arc::new(ServerManager::new(db.clone(), event_bus));
        manager.load_from_db().await;

        tokio::time::timeout(
            std::time::Duration::from_millis(6_500),
            manager.start_server(&server_id),
        )
        .await
        .expect("startup should not be cut off by request timeout")
        .expect("startup should succeed with the larger startup timeout");

        let err = tokio::time::timeout(
            std::time::Duration::from_millis(6_500),
            manager.call_tool("phase__echo", serde_json::json!({})),
        )
        .await
        .expect("tool call should return before the outer timeout")
        .expect_err("runtime requests should restore the configured request timeout");
        assert!(err.contains("timed out after 5s"));

        manager.stop_server(&server_id).await.expect("stop failed");
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn first_start_respects_configured_server_start_timeout() {
        let data_dir = temp_data_dir("first-start-timeout");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp dir");
        let marker = data_dir.join("starts.log");
        let script =
            write_delayed_mcp_server(&data_dir, &marker, "very-slow-start.mjs", "slow", 20_000);

        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to run migrations");
        settings::update_settings(
            &db,
            serde_json::json!({
                "advanced": {
                    "mcpRequestTimeoutMs": 300_000,
                    "mcpServerStartTimeoutMs": 5_000
                }
            }),
        )
        .expect("settings update should succeed");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");

        let server_id = uuid::Uuid::new_v4().to_string();
        insert_stdio_server(&db, &server_id, "slow", script, false, 0);
        profile_repo
            .assign_to_active_profile(std::slice::from_ref(&server_id))
            .expect("failed to assign server");

        let event_bus = Arc::new(EventBus::new(16));
        let manager = Arc::new(ServerManager::new(db.clone(), event_bus));
        manager.load_from_db().await;

        let result = tokio::time::timeout(
            std::time::Duration::from_millis(6_500),
            manager.start_server(&server_id),
        )
        .await
        .expect("server start should return before the outer timeout");
        let err = result.expect_err("slow first start should fail");

        assert!(err.contains("Server start timed out after 5s"));
        let runtime = manager
            .get_server(&server_id)
            .await
            .expect("server should remain registered");
        assert_eq!(runtime.status, "error");

        let stored = ServerRepository::new(&db)
            .find_by_id(&server_id)
            .expect("server should load")
            .expect("server should exist");
        assert_eq!(stored.status, "error");
        assert_eq!(
            stored.error_message.as_deref(),
            Some("Server failed to start. Check logs for details.")
        );

        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn initialize_client_info_uses_configured_server_name() {
        let data_dir = temp_data_dir("client-info-name");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp dir");
        let marker = data_dir.join("client-info.log");
        let script = write_client_info_mcp_server(&data_dir, &marker);

        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to run migrations");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");

        let server_id = uuid::Uuid::new_v4().to_string();
        insert_stdio_server(&db, &server_id, "readable-server", script, false, 0);
        profile_repo
            .assign_to_active_profile(std::slice::from_ref(&server_id))
            .expect("failed to assign server");

        let event_bus = Arc::new(EventBus::new(16));
        let manager = Arc::new(ServerManager::new(db, event_bus));
        manager.load_from_db().await;

        manager
            .start_server(&server_id)
            .await
            .expect("server should start");

        let client_info =
            std::fs::read_to_string(&marker).expect("client info marker should exist");
        assert_eq!(client_info.trim(), "moor-readable-server");

        manager.stop_server(&server_id).await.expect("stop failed");
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn stop_while_starting_keeps_server_stopped_and_discards_stale_tools() {
        let data_dir = temp_data_dir("stop-during-start");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp dir");
        let marker = data_dir.join("starts.log");
        let script = write_delayed_mcp_server(&data_dir, &marker, "stale-start.mjs", "stale", 300);

        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to run migrations");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");

        let server_id = uuid::Uuid::new_v4().to_string();
        insert_stdio_server(&db, &server_id, "stale", script, false, 0);
        profile_repo
            .assign_to_active_profile(std::slice::from_ref(&server_id))
            .expect("failed to assign server");

        let event_bus = Arc::new(EventBus::new(16));
        let manager = Arc::new(ServerManager::new(db.clone(), event_bus));
        manager.load_from_db().await;

        let start = {
            let manager = manager.clone();
            let server_id = server_id.clone();
            tokio::spawn(async move { manager.start_server(&server_id).await })
        };

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        manager.stop_server(&server_id).await.expect("stop failed");
        start
            .await
            .expect("start task failed")
            .expect("stale start should finish without overwriting stopped state");

        let runtime = manager
            .get_server(&server_id)
            .await
            .expect("server should remain registered");
        assert_eq!(runtime.status, "stopped");

        let stored = ServerRepository::new(&db)
            .find_by_id(&server_id)
            .expect("server should load")
            .expect("server should exist");
        assert_eq!(stored.status, "stopped");

        let stale_tools = ToolDiscoveryRepository::new(&db)
            .find_by_server_id(&server_id)
            .expect("tool discovery query should succeed");
        assert!(stale_tools.is_empty());

        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn stop_while_starting_ignores_stale_start_failure() {
        let data_dir = temp_data_dir("stop-during-start-failure");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp dir");
        let marker = data_dir.join("starts.log");
        let script = write_erroring_mcp_server(
            &data_dir,
            &marker,
            "stale-start-failure.mjs",
            "stale-failure",
            "initialize",
            300,
            None,
        );

        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to run migrations");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");

        let server_id = uuid::Uuid::new_v4().to_string();
        insert_stdio_server(&db, &server_id, "stale-failure", script, false, 0);
        profile_repo
            .assign_to_active_profile(std::slice::from_ref(&server_id))
            .expect("failed to assign server");

        let event_bus = Arc::new(EventBus::new(16));
        let manager = Arc::new(ServerManager::new(db.clone(), event_bus));
        manager.load_from_db().await;

        let start = {
            let manager = manager.clone();
            let server_id = server_id.clone();
            tokio::spawn(async move { manager.start_server(&server_id).await })
        };

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        manager.stop_server(&server_id).await.expect("stop failed");
        start
            .await
            .expect("start task failed")
            .expect("stale failure should not surface after stop");

        let runtime = manager
            .get_server(&server_id)
            .await
            .expect("server should remain registered");
        assert_eq!(runtime.status, "stopped");

        let stored = ServerRepository::new(&db)
            .find_by_id(&server_id)
            .expect("server should load")
            .expect("server should exist");
        assert_eq!(stored.status, "stopped");

        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[tokio::test]
    async fn tool_list_stdio_stderr_summary_is_appended_once() {
        let data_dir = temp_data_dir("tool-list-stderr-once");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp dir");
        let marker = data_dir.join("starts.log");
        let script = write_erroring_mcp_server(
            &data_dir,
            &marker,
            "tool-list-stderr-once.mjs",
            "stderr-once",
            "tools/list",
            0,
            Some("npm ERR! package not found"),
        );

        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to run migrations");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");

        let server_id = uuid::Uuid::new_v4().to_string();
        insert_stdio_server(&db, &server_id, "stderr-once", script, false, 0);
        profile_repo
            .assign_to_active_profile(std::slice::from_ref(&server_id))
            .expect("failed to assign server");

        let event_bus = Arc::new(EventBus::new(16));
        let manager = Arc::new(ServerManager::new(db.clone(), event_bus));
        manager.load_from_db().await;

        let err = manager
            .start_server(&server_id)
            .await
            .expect_err("tool discovery should fail");
        assert_eq!(err.matches(". stdio stderr: ").count(), 1);

        let stored = ServerRepository::new(&db)
            .find_by_id(&server_id)
            .expect("server should load")
            .expect("server should exist");
        assert_eq!(
            stored.error_message.as_deref(),
            Some("Server failed to start: npm ERR! package not found")
        );

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
