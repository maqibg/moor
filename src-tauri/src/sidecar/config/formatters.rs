use super::clients::ClientMeta;
use super::import_parser::ScannedServer;
use serde_json::Value;

pub struct FormatResult {
    pub content: String,
    pub warnings: Vec<String>,
}

fn non_empty(obj: &Option<std::collections::HashMap<String, String>>) -> bool {
    obj.as_ref().map(|m| !m.is_empty()).unwrap_or(false)
}

fn toml_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn toml_key(key: &str) -> String {
    if key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        key.to_string()
    } else {
        toml_string(key)
    }
}

fn toml_array(values: &[String]) -> String {
    format!(
        "[{}]",
        values
            .iter()
            .map(|v| toml_string(v))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn toml_inline_table(values: &std::collections::HashMap<String, String>) -> String {
    format!(
        "{{ {} }}",
        values
            .iter()
            .map(|(k, v)| format!("{} = {}", toml_string(k), toml_string(v)))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn rewrite_headers(
    headers: &Option<std::collections::HashMap<String, String>>,
    client: &ClientMeta,
) -> Option<std::collections::HashMap<String, String>> {
    headers.as_ref().map(|h| {
        h.iter()
            .map(|(k, v)| (k.clone(), rewrite_header_value(v, client)))
            .collect()
    })
}

fn rewrite_header_value(value: &str, client: &ClientMeta) -> String {
    let patterns = [
        regex_lite::Regex::new(r"\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}").ok(),
        regex_lite::Regex::new(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}").ok(),
        regex_lite::Regex::new(r"\{env:([A-Za-z_][A-Za-z0-9_]*)\}").ok(),
    ];

    for pattern in patterns.iter().flatten() {
        if let Some(caps) = pattern.captures(value) {
            let name = &caps[1];
            let env_ref = env_ref_for_client(name, client);
            // `$$` 转义替换模板里 `$` 的组引用语法——
            // 否则 ${...} 引用会被展开成空串。
            let literal = env_ref.replace('$', "$$");
            let full = pattern.replace(value, &literal).to_string();
            return full;
        }
    }
    value.to_string()
}

// 每客户端的 JSON entry 形状——新客户端方言的唯一声明处；
// dsh/codex 的 TOML 路径不走这些字段。
#[derive(Debug, Clone, Copy)]
struct JsonDialect {
    stdio_type: Option<&'static str>,
    command_array: bool,
    env_key: &'static str,
    http_type: Option<&'static str>,
    headers_key: &'static str,
    env_ref: EnvRefStyle,
}

#[derive(Debug, Clone, Copy)]
enum EnvRefStyle {
    Dollar,
    DollarEnv,
    BraceEnv,
}

impl EnvRefStyle {
    fn render(self, name: &str) -> String {
        match self {
            EnvRefStyle::Dollar => format!("${{{name}}}"),
            EnvRefStyle::DollarEnv => format!("${{env:{name}}}"),
            EnvRefStyle::BraceEnv => format!("{{env:{name}}}"),
        }
    }
}

const DEFAULT_JSON_DIALECT: JsonDialect = JsonDialect {
    stdio_type: None,
    command_array: false,
    env_key: "env",
    http_type: None,
    headers_key: "headers",
    env_ref: EnvRefStyle::BraceEnv,
};

fn json_dialect(client_id: &str) -> JsonDialect {
    match client_id {
        "claude-code" => JsonDialect {
            env_ref: EnvRefStyle::Dollar,
            ..DEFAULT_JSON_DIALECT
        },
        "opencode" => JsonDialect {
            stdio_type: Some("local"),
            command_array: true,
            env_key: "environment",
            http_type: Some("remote"),
            ..DEFAULT_JSON_DIALECT
        },
        "cursor" => JsonDialect {
            stdio_type: Some("stdio"),
            env_ref: EnvRefStyle::DollarEnv,
            ..DEFAULT_JSON_DIALECT
        },
        _ => DEFAULT_JSON_DIALECT,
    }
}

fn env_ref_for_client(name: &str, client: &ClientMeta) -> String {
    json_dialect(client.id).env_ref.render(name)
}

// YAML single-quoted scalar: only ' needs escaping (doubled).
fn yaml_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

// dsh serverName is constrained to [A-Za-z0-9_-]{1,32}.
fn dsh_server_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "mcp-server".to_string()
    } else {
        trimmed.chars().take(32).collect()
    }
}

// Header env refs become one whole `!!js` expression (a partial rewrite would
// leak as a literal string), matching dsh's official examples. `!!js` is only
// emitted here — user-supplied values stay quoted so imported `!!js` text
// can never execute.
fn dsh_header_value(value: &str) -> String {
    if let Some(var) = value
        .strip_prefix("Bearer {env:")
        .and_then(|s| s.strip_suffix('}'))
    {
        // The quoted-scalar form is dsh's documented syntax; a bare backtick
        // template is not a valid YAML node and fails dsh's loud parse.
        format!("!!js '`Bearer ${{process.env.{var}}}`'")
    } else if let Some(var) = value
        .strip_prefix("{env:")
        .and_then(|s| s.strip_suffix('}'))
    {
        format!("!!js process.env.{var}")
    } else {
        yaml_quote(value)
    }
}

fn stdio_entry(server: &ScannedServer, dialect: &JsonDialect) -> Value {
    let mut entry = serde_json::Map::new();

    if let Some(t) = dialect.stdio_type {
        entry.insert("type".to_string(), Value::String(t.to_string()));
    }
    if dialect.command_array {
        let cmd = server.command.as_deref().unwrap_or("");
        let mut cmd_arr = vec![Value::String(cmd.to_string())];
        if let Some(args) = &server.args {
            cmd_arr.extend(args.iter().map(|a| Value::String(a.clone())));
        }
        entry.insert("command".to_string(), Value::Array(cmd_arr));
    } else {
        entry.insert(
            "command".to_string(),
            Value::String(server.command.clone().unwrap_or_default()),
        );
        if let Some(args) = &server.args {
            if !args.is_empty() {
                entry.insert(
                    "args".to_string(),
                    serde_json::to_value(args).unwrap_or(Value::Null),
                );
            }
        }
    }
    if non_empty(&server.env) {
        entry.insert(
            dialect.env_key.to_string(),
            serde_json::to_value(&server.env).unwrap_or(Value::Null),
        );
    }
    Value::Object(entry)
}

fn http_entry(server: &ScannedServer, client: &ClientMeta, dialect: &JsonDialect) -> Value {
    let mut entry = serde_json::Map::new();

    if let Some(t) = dialect.http_type {
        entry.insert("type".to_string(), Value::String(t.to_string()));
    }
    entry.insert(
        "url".to_string(),
        Value::String(server.url.clone().unwrap_or_default()),
    );
    if let Some(headers) = rewrite_headers(&server.headers, client) {
        entry.insert(
            dialect.headers_key.to_string(),
            serde_json::to_value(&headers).unwrap_or(Value::Null),
        );
    }
    Value::Object(entry)
}
fn format_json_mcp_servers(
    servers: &[ScannedServer],
    client: &ClientMeta,
    top_level_key: &str,
    extra_warnings: Vec<String>,
) -> FormatResult {
    let mut mcp_servers = serde_json::Map::new();
    let dialect = json_dialect(client.id);
    for s in servers {
        let entry = if s.connection_type == "stdio" {
            stdio_entry(s, &dialect)
        } else {
            http_entry(s, client, &dialect)
        };
        mcp_servers.insert(s.name.clone(), entry);
    }

    let mut warnings = build_warnings(servers, client);
    warnings.extend(extra_warnings);

    FormatResult {
        content: serde_json::to_string_pretty(&serde_json::json!({ top_level_key: mcp_servers }))
            .unwrap_or_default(),
        warnings,
    }
}

fn build_warnings(servers: &[ScannedServer], client: &ClientMeta) -> Vec<String> {
    let mut warnings = vec![];
    if servers.iter().any(|s| non_empty(&s.headers)) && client.id == "codex" {
        warnings.push("Headers have been mapped to Codex's http_headers/env_http_headers. Please verify manually.".to_string());
    }
    if servers.iter().any(|s| s.working_dir.is_some())
        && (client.id == "opencode" || client.id == "cursor")
    {
        warnings.push(format!(
            "{} does not natively support the workingDir field. It has been ignored.",
            client.name
        ));
    }
    if servers.iter().any(|s| non_empty(&s.env)) && client.id == "opencode" {
        warnings
            .push("Environment variables have been mapped to the environment field.".to_string());
    }
    warnings
}

pub fn format_for_claude_code(servers: &[ScannedServer], client: &ClientMeta) -> FormatResult {
    format_json_mcp_servers(servers, client, "mcpServers", vec![])
}

pub fn format_for_codex(servers: &[ScannedServer], client: &ClientMeta) -> FormatResult {
    let mut lines = vec![];
    for s in servers {
        lines.push(format!("[mcp_servers.{}]", toml_key(&s.name)));
        if s.connection_type == "stdio" {
            lines.push(format!(
                "command = {}",
                toml_string(s.command.as_deref().unwrap_or(""))
            ));
            if let Some(args) = &s.args {
                if !args.is_empty() {
                    lines.push(format!("args = {}", toml_array(args)));
                }
            }
            if non_empty(&s.env) {
                lines.push(format!(
                    "env = {}",
                    toml_inline_table(s.env.as_ref().unwrap())
                ));
            }
            if let Some(wd) = &s.working_dir {
                lines.push(format!("cwd = {}", toml_string(wd)));
            }
        } else {
            lines.push(format!(
                "url = {}",
                toml_string(s.url.as_deref().unwrap_or(""))
            ));
            if let Some(headers) = &s.headers {
                for (k, v) in headers {
                    if k.to_lowercase() == "authorization"
                        && v.starts_with("Bearer {env:")
                        && v.ends_with("}")
                    {
                        if let Some(var) = v
                            .strip_prefix("Bearer {env:")
                            .and_then(|s| s.strip_suffix('}'))
                        {
                            lines.push(format!("bearer_token_env_var = {}", toml_string(var)));
                            continue;
                        }
                    }
                    lines.push(format!("http_headers = {}", toml_inline_table(headers)));
                    break;
                }
            }
        }
        lines.push("enabled = true".to_string());
        lines.push(String::new());
    }
    FormatResult {
        content: lines.join("\n").trim_end().to_string(),
        warnings: build_warnings(servers, client),
    }
}

pub fn format_for_opencode(servers: &[ScannedServer], client: &ClientMeta) -> FormatResult {
    let mut result = format_json_mcp_servers(servers, client, "mcp", vec![]);
    let mut parsed: Value = serde_json::from_str(&result.content).unwrap_or_default();
    if let Some(mcp) = parsed.get_mut("mcp").and_then(|v| v.as_object_mut()) {
        for (_key, entry) in mcp.iter_mut() {
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("enabled".to_string(), Value::Bool(true));
            }
        }
    }
    if let Some(obj) = parsed.as_object_mut() {
        obj.insert(
            "$schema".to_string(),
            Value::String("https://opencode.ai/config.json".to_string()),
        );
    }
    result.content = serde_json::to_string_pretty(&parsed).unwrap_or_default();
    result
}

pub fn format_for_cursor(servers: &[ScannedServer], client: &ClientMeta) -> FormatResult {
    let has_http = servers.iter().any(|s| s.connection_type == "http");
    let extra = if has_http {
        vec!["HTTP servers use streamable-http transport by default. For SSE, change the type field to \"sse\".".to_string()]
    } else {
        vec![]
    };
    format_json_mcp_servers(servers, client, "mcpServers", extra)
}

pub fn format_for_kimi_code(servers: &[ScannedServer], client: &ClientMeta) -> FormatResult {
    format_json_mcp_servers(servers, client, "mcpServers", vec![])
}

// One `dsh-mcp-client` plugin row per server, as a single top-level insert list.
pub fn format_for_dsh(servers: &[ScannedServer], client: &ClientMeta) -> FormatResult {
    // dsh has no SSE transport; those servers are skipped with a warning below.
    let mut lines: Vec<String> = vec![];
    let mut skipped_sse = 0usize;
    for s in servers {
        if s.connection_type == "sse" {
            skipped_sse += 1;
            continue;
        }
        let server_name = dsh_server_name(&s.name);
        lines.push(format!("    - id: {}", yaml_quote(&server_name)));
        lines.push("      name: '@deepseek-ai/dsh-mcp-client'".to_string());
        lines.push("      config:".to_string());
        lines.push(format!("        serverName: {}", yaml_quote(&server_name)));
        if s.connection_type == "stdio" {
            lines.push("        transport: stdio".to_string());
            lines.push(format!(
                "        command: {}",
                yaml_quote(s.command.as_deref().unwrap_or(""))
            ));
            if let Some(args) = &s.args {
                if !args.is_empty() {
                    let rendered = args
                        .iter()
                        .map(|a| yaml_quote(a))
                        .collect::<Vec<_>>()
                        .join(", ");
                    lines.push(format!("        args: [{rendered}]"));
                }
            }
            if non_empty(&s.env) {
                lines.push("        env:".to_string());
                for (k, v) in s.env.as_ref().unwrap() {
                    lines.push(format!(
                        "          {}: {}",
                        yaml_quote(k),
                        dsh_header_value(v)
                    ));
                }
            }
            if let Some(wd) = &s.working_dir {
                lines.push(format!("        cwd: {}", yaml_quote(wd)));
            }
        } else {
            lines.push("        transport: streamable-http".to_string());
            lines.push(format!(
                "        url: {}",
                yaml_quote(s.url.as_deref().unwrap_or(""))
            ));
            if non_empty(&s.headers) {
                lines.push("        headers:".to_string());
                for (k, v) in s.headers.as_ref().unwrap() {
                    lines.push(format!(
                        "          {}: {}",
                        yaml_quote(k),
                        dsh_header_value(v)
                    ));
                }
            }
        }
    }
    if !lines.is_empty() {
        lines.insert(0, "- insert:".to_string());
    }
    let mut warnings = build_warnings(servers, client);
    if skipped_sse > 0 {
        warnings.push(format!(
            "dsh does not support the SSE transport. Skipped {skipped_sse} SSE server(s)."
        ));
    }
    FormatResult {
        content: lines.join("\n"),
        warnings,
    }
}

pub fn format_for_client(
    client_id: &str,
) -> Option<fn(&[ScannedServer], &ClientMeta) -> FormatResult> {
    match client_id {
        "claude-code" => Some(format_for_claude_code),
        "codex" => Some(format_for_codex),
        "opencode" => Some(format_for_opencode),
        "cursor" => Some(format_for_cursor),
        "kimi-code" => Some(format_for_kimi_code),
        "dsh" => Some(format_for_dsh),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::config::clients;

    fn client(id: &str) -> &'static ClientMeta {
        clients::get_client_by_id(id).unwrap()
    }

    fn stdio_server() -> ScannedServer {
        ScannedServer {
            name: "filesystem".to_string(),
            connection_type: "stdio".to_string(),
            url: None,
            source: "test".to_string(),
            command: Some("npx".to_string()),
            args: Some(vec!["-y".to_string(), "server-fs".to_string()]),
            env: Some(
                [("FS_TOKEN".to_string(), "abc'x".to_string())]
                    .into_iter()
                    .collect(),
            ),
            headers: None,
            working_dir: Some("/tmp".to_string()),
        }
    }

    fn http_server() -> ScannedServer {
        ScannedServer {
            name: "moor-mcp".to_string(),
            connection_type: "http".to_string(),
            url: Some("http://127.0.0.1:9223/mcp".to_string()),
            source: "test".to_string(),
            command: None,
            args: None,
            env: None,
            headers: Some(
                [(
                    "Authorization".to_string(),
                    "Bearer {env:MOOR_TOKEN}".to_string(),
                )]
                .into_iter()
                .collect(),
            ),
            working_dir: None,
        }
    }

    #[test]
    fn formats_dsh_http_insert_row() {
        let result = format_for_dsh(std::slice::from_ref(&http_server()), client("dsh"));
        assert_eq!(
            result.content,
            "- insert:\n\
             \x20   - id: 'moor-mcp'\n\
             \x20     name: '@deepseek-ai/dsh-mcp-client'\n\
             \x20     config:\n\
             \x20       serverName: 'moor-mcp'\n\
             \x20       transport: streamable-http\n\
             \x20       url: 'http://127.0.0.1:9223/mcp'\n\
             \x20       headers:\n\
             \x20         'Authorization': !!js '`Bearer ${process.env.MOOR_TOKEN}`'"
        );
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn formats_dsh_stdio_insert_row() {
        let result = format_for_dsh(std::slice::from_ref(&stdio_server()), client("dsh"));
        assert!(result.content.contains("transport: stdio"));
        assert!(result.content.contains("command: 'npx'"));
        assert!(result.content.contains("args: ['-y', 'server-fs']"));
        // Single quotes inside values double-escape per YAML rules.
        assert!(result.content.contains("'FS_TOKEN': 'abc''x'"));
        assert!(result.content.contains("cwd: '/tmp'"));
    }

    #[test]
    fn dsh_rewrites_env_refs_to_js_expressions() {
        let mut server = stdio_server();
        server.env = Some(
            [("MOOR_TOKEN".to_string(), "{env:MOOR_TOKEN}".to_string())]
                .into_iter()
                .collect(),
        );
        let result = format_for_dsh(std::slice::from_ref(&server), client("dsh"));
        assert!(result
            .content
            .contains("'MOOR_TOKEN': !!js process.env.MOOR_TOKEN"));
    }

    #[test]
    fn dsh_skips_sse_servers_with_warning() {
        let mut sse = http_server();
        sse.connection_type = "sse".to_string();
        let result = format_for_dsh(&[http_server(), sse], client("dsh"));
        assert_eq!(result.content.matches("- id:").count(), 1);
        assert!(result.warnings.iter().any(|w| w.contains("SSE transport")));
    }

    #[test]
    fn dsh_server_name_sanitizes_to_contract() {
        assert_eq!(dsh_server_name("my.tool: v2"), "my-tool--v2");
        assert_eq!(dsh_server_name("a".repeat(40).as_str()).len(), 32);
        assert_eq!(dsh_server_name("---"), "mcp-server");
    }

    #[test]
    fn formats_kimi_code_mcp_servers() {
        let result = format_for_kimi_code(&[http_server(), stdio_server()], client("kimi-code"));
        let parsed: Value = serde_json::from_str(&result.content).unwrap();
        let servers = parsed.get("mcpServers").unwrap().as_object().unwrap();
        assert_eq!(servers.len(), 2);
        // HTTP entries stay transport-free (bare url = HTTP in Kimi Code).
        assert!(servers.get("moor-mcp").unwrap().get("transport").is_none());
        let local = servers.get("filesystem").unwrap();
        assert_eq!(local.get("command").unwrap().as_str().unwrap(), "npx");
    }

    #[test]
    fn every_registered_client_has_a_formatter() {
        for client in clients::ALL_CLIENTS {
            assert!(
                format_for_client(client.id).is_some(),
                "registry client `{}` has no formatter",
                client.id
            );
        }
    }

    #[test]
    fn opencode_dialect_shapes_local_and_remote_entries() {
        let result = format_for_opencode(&[stdio_server(), http_server()], client("opencode"));
        let parsed: Value = serde_json::from_str(&result.content).unwrap();
        let mcp = parsed.get("mcp").unwrap().as_object().unwrap();

        let local = mcp.get("filesystem").unwrap();
        assert_eq!(local.get("type").unwrap(), "local");
        assert_eq!(local.get("command").unwrap().as_array().unwrap()[0], "npx");
        // args 折叠进 command 数组；env 映射为 `environment`。
        assert!(local.get("args").is_none());
        assert!(local.get("environment").is_some());
        assert!(local.get("env").is_none());

        let remote = mcp.get("moor-mcp").unwrap();
        assert_eq!(remote.get("type").unwrap(), "remote");
        assert_eq!(
            remote.get("headers").unwrap().get("Authorization").unwrap(),
            "Bearer {env:MOOR_TOKEN}"
        );
    }

    #[test]
    fn cursor_dialect_marks_stdio_type_and_dollar_env_refs() {
        let result = format_for_cursor(&[stdio_server(), http_server()], client("cursor"));
        let parsed: Value = serde_json::from_str(&result.content).unwrap();
        let servers = parsed.get("mcpServers").unwrap().as_object().unwrap();

        assert_eq!(
            servers.get("filesystem").unwrap().get("type").unwrap(),
            "stdio"
        );
        let http = servers.get("moor-mcp").unwrap();
        assert_eq!(
            http.get("headers").unwrap().get("Authorization").unwrap(),
            "Bearer ${env:MOOR_TOKEN}"
        );
    }
}
