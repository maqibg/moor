use serde_json::Value;
use std::collections::HashMap;

/// MCP Client over HTTP transport (Streamable HTTP or SSE).
/// Uses reqwest to communicate with HTTP-based MCP servers.
pub struct HttpClientTransport {
    url: String,
    headers: HashMap<String, String>,
    client: reqwest::Client,
}

impl HttpClientTransport {
    pub fn new(url: &str, headers: HashMap<String, String>) -> Self {
        Self {
            url: url.to_string(),
            headers,
            client: reqwest::Client::new(),
        }
    }

    /// Send a JSON-RPC request and get the response.
    /// First attempts Streamable HTTP, falls back to SSE on failure.
    pub async fn send_request(
        &self,
        id: i64,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        let request_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params.unwrap_or(Value::Null),
        });

        let mut builder = self.client.post(&self.url);
        for (key, value) in &self.headers {
            builder = builder.header(key, value);
        }
        builder = builder
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2024-11-05");

        let response = builder
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {e}"))?;

        let status = response.status();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if content_type.contains("text/event-stream") {
            // SSE response — parse the first event
            let body = response
                .text()
                .await
                .map_err(|e| format!("Failed to read SSE response: {e}"))?;
            parse_sse_response(&body)
        } else {
            // JSON response
            let body = response
                .json::<Value>()
                .await
                .map_err(|e| format!("Failed to parse JSON response ({status}): {e}"))?;

            if let Some(error) = body.get("error") {
                let msg = error
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                return Err(msg.to_string());
            }
            Ok(body.get("result").cloned().unwrap_or(Value::Null))
        }
    }

    pub async fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let request_body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params.unwrap_or(Value::Null),
        });

        let mut builder = self.client.post(&self.url);
        for (key, value) in &self.headers {
            builder = builder.header(key, value);
        }
        builder
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2024-11-05")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("HTTP notification failed: {e}"))?;
        Ok(())
    }
}

fn parse_sse_response(body: &str) -> Result<Value, String> {
    for line in body.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            let parsed: Value =
                serde_json::from_str(data).map_err(|e| format!("Invalid SSE data JSON: {e}"))?;
            if let Some(error) = parsed.get("error") {
                let msg = error
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                return Err(msg.to_string());
            }
            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
        }
    }
    Err("No data event found in SSE response".into())
}

/// Resolve header values that may contain `{env:VAR_NAME}` patterns.
pub fn resolve_http_headers(headers: Option<&HashMap<String, String>>) -> HashMap<String, String> {
    let Some(headers) = headers else {
        return HashMap::new();
    };
    headers
        .iter()
        .filter_map(|(k, v)| {
            let resolved = resolve_header_value(v)?;
            Some((k.clone(), resolved))
        })
        .collect()
}

fn resolve_header_value(value: &str) -> Option<String> {
    let mut missing = false;
    let resolved = regex_lite::Regex::new(r"\{env:([A-Za-z_][A-Za-z0-9_]*)\}")
        .ok()
        .map(|re| {
            re.replace_all(value, |caps: &regex_lite::Captures| {
                let var_name = &caps[1];
                match std::env::var(var_name) {
                    Ok(val) => val,
                    Err(_) => {
                        missing = true;
                        String::new()
                    }
                }
            })
            .to_string()
        })
        .unwrap_or_else(|| value.to_string());

    if missing {
        None
    } else {
        Some(resolved)
    }
}
