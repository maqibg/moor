use super::jsonrpc;
use crate::sidecar::db::audit_log_repo::AuditLogRepository;
use crate::sidecar::db::profile_repo::ProfileRepository;
use crate::sidecar::http::AppState;
use crate::sidecar::services::audit_redaction::redact_for_audit;
use crate::sidecar::services::settings::audit_logging_enabled;
use std::sync::Arc;

/// Handle an incoming MCP JSON-RPC request and produce a response.
/// This implements the MCP Gateway: aggregates tools from all running servers
/// and routes tool calls to the correct server.
pub async fn handle_request(
    id: jsonrpc::Id,
    method: &str,
    params: Option<serde_json::Value>,
    state: Arc<AppState>,
    agent_info: Option<&str>,
) -> serde_json::Value {
    match method {
        "initialize" => handle_initialize(id),
        "tools/list" => handle_tools_list(id, state).await,
        "tools/call" => handle_tools_call(id, params, state, agent_info).await,
        "ping" => jsonrpc::make_response(id, serde_json::json!({})),
        _ => jsonrpc::make_error(
            id,
            jsonrpc::METHOD_NOT_FOUND,
            &format!("Unknown method: {method}"),
        ),
    }
}

fn handle_initialize(id: jsonrpc::Id) -> serde_json::Value {
    jsonrpc::make_response(
        id,
        serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": { "listChanged": true } },
            "serverInfo": { "name": "Moor", "version": env!("CARGO_PKG_VERSION") },
        }),
    )
}

async fn handle_tools_list(id: jsonrpc::Id, state: Arc<AppState>) -> serde_json::Value {
    let catalog = state.server_manager.get_tool_catalog(None).await;
    let tools: Vec<serde_json::Value> = catalog
        .iter()
        .map(|tool| {
            serde_json::json!({
                "name": tool.exposed_name,
                "description": tool.description,
                "inputSchema": tool
                    .input_schema
                    .clone()
                    .unwrap_or_else(|| serde_json::json!({"type": "object"})),
            })
        })
        .collect();
    jsonrpc::make_response(id, serde_json::json!({ "tools": tools }))
}

async fn handle_tools_call(
    id: jsonrpc::Id,
    params: Option<serde_json::Value>,
    state: Arc<AppState>,
    agent_info: Option<&str>,
) -> serde_json::Value {
    let params = match params {
        Some(p) => p,
        None => return jsonrpc::make_error(id, jsonrpc::INVALID_PARAMS, "Missing params"),
    };
    let tool_name = match params.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return jsonrpc::make_error(id, jsonrpc::INVALID_PARAMS, "Missing tool name"),
    };
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or(serde_json::json!({}));

    let catalog = state.server_manager.get_tool_catalog(None).await;
    let owner = match catalog
        .iter()
        .find(|t| t.exposed_name == tool_name)
        .cloned()
    {
        Some(t) => t,
        None => {
            let error = format!("Tool \"{tool_name}\" not found or disabled");
            record_audit(
                &state,
                None,
                tool_name,
                &arguments,
                None,
                Some(&error),
                0,
                agent_info,
            );
            return jsonrpc::make_error(id, jsonrpc::INVALID_PARAMS, &error);
        }
    };

    let start_time = std::time::Instant::now();
    match state
        .server_manager
        .call_tool(tool_name, arguments.clone())
        .await
    {
        Ok(result) => {
            record_audit(
                &state,
                Some(&owner.server_id),
                tool_name,
                &arguments,
                Some(&result),
                None,
                start_time.elapsed().as_millis() as i64,
                agent_info,
            );
            jsonrpc::make_response(id, result)
        }
        Err(err) => {
            record_audit(
                &state,
                Some(&owner.server_id),
                tool_name,
                &arguments,
                None,
                Some(&err),
                start_time.elapsed().as_millis() as i64,
                agent_info,
            );
            jsonrpc::make_error(id, jsonrpc::INTERNAL_ERROR, &err)
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn record_audit(
    state: &AppState,
    server_id: Option<&str>,
    tool_name: &str,
    arguments: &serde_json::Value,
    result: Option<&serde_json::Value>,
    error: Option<&str>,
    duration_ms: i64,
    agent_info: Option<&str>,
) {
    if !audit_logging_enabled(state.db.as_ref()) {
        return;
    }

    let profile_repo = ProfileRepository::new(&state.db);
    let profile_id = profile_repo.find_active_id().ok().flatten();
    let repo = AuditLogRepository::new(&state.db);
    let redacted_args = redact_for_audit(arguments);
    let redacted_result = result.map(redact_for_audit);
    let _ = repo.insert(
        &uuid::Uuid::new_v4().to_string(),
        &chrono::Utc::now().to_rfc3339(),
        profile_id.as_deref(),
        server_id,
        tool_name,
        Some(&redacted_args),
        redacted_result.as_ref(),
        error,
        duration_ms,
        agent_info,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::db::profile_repo::ProfileRepository;
    use crate::sidecar::db::server_repo::ServerRepository;
    use crate::sidecar::db::Database;
    use crate::sidecar::services::event_bus::EventBus;
    use crate::sidecar::services::server_manager::ServerManager;
    use std::sync::Arc;
    use std::time::SystemTime;

    fn temp_data_dir(test_name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moor-mcp-{test_name}-{timestamp}"))
    }

    fn write_fake_mcp_server(data_dir: &std::path::Path) -> std::path::PathBuf {
        let script = data_dir.join("fake-mcp-server.mjs");
        std::fs::write(
            &script,
            r#"
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.id === undefined) continue;
    let result = {};
    if (request.method === "initialize") {
      result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1.0.0" } };
    } else if (request.method === "tools/list") {
      result = { tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object" } }] };
    } else if (request.method === "tools/call") {
      result = { content: [{ type: "text", text: JSON.stringify(request.params.arguments ?? {}) }] };
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  }
});
"#,
        )
        .expect("failed to write fake MCP server");
        script
    }

    #[tokio::test]
    async fn tools_call_routes_to_running_server_and_records_audit() {
        let data_dir = temp_data_dir("tools-call");
        std::fs::create_dir_all(&data_dir).expect("failed to create temp data dir");
        let script = write_fake_mcp_server(&data_dir);

        let db = Arc::new(Database::open(&data_dir.join("moor.db")).expect("failed to open db"));
        db.run_migrations().expect("failed to migrate");
        crate::sidecar::services::settings::init_settings(db.as_ref(), &data_dir)
            .expect("failed to initialize settings");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");

        let server_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let args = serde_json::to_string(&vec![script.to_string_lossy().to_string()])
            .expect("failed to serialize args");
        let server_repo = ServerRepository::new(&db);
        server_repo
            .insert(
                &server_id,
                "fake",
                "stdio",
                Some("node"),
                Some(&args),
                None,
                None,
                None,
                None,
                false,
                0,
                &now,
                &now,
            )
            .expect("failed to insert server");
        profile_repo
            .assign_to_active_profile(std::slice::from_ref(&server_id))
            .expect("failed to assign server");

        let event_bus = Arc::new(EventBus::new(16));
        let server_manager = Arc::new(ServerManager::new(db.clone(), event_bus.clone()));
        server_manager.load_from_db().await;
        server_manager
            .start_server(&server_id)
            .await
            .expect("failed to start fake server");

        let app_state = Arc::new(AppState {
            db: db.clone(),
            api_token: "test-token".to_string(),
            version: "test".to_string(),
            port: 19323,
            event_bus,
            server_manager,
        });

        let response = handle_request(
            jsonrpc::Id::Number(1),
            "tools/call",
            Some(serde_json::json!({
                "name": "echo",
                "arguments": { "token": "secret", "value": "ok" }
            })),
            app_state,
            Some("test-agent"),
        )
        .await;

        assert_eq!(response["result"]["content"][0]["type"], "text");
        assert!(response["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("\"value\":\"ok\""));

        let audit_repo = AuditLogRepository::new(&db);
        let logs = audit_repo
            .query_logs(None, Some("echo"), None, None, Some(10), None)
            .expect("failed to query audit logs");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].server_id.as_deref(), Some(server_id.as_str()));
        assert_eq!(logs[0].arguments.as_ref().unwrap()["token"], "[REDACTED]");

        let _ = std::fs::remove_dir_all(data_dir);
    }
}
