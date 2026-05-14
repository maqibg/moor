use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::Mutex;

/// MCP Client over HTTP transport (Streamable HTTP or SSE).
/// Uses reqwest to communicate with HTTP-based MCP servers.
pub struct HttpClientTransport {
    url: String,
    headers: HashMap<String, String>,
    client: reqwest::Client,
    mode: Mutex<HttpMode>,
}

enum HttpMode {
    Unknown,
    Streamable,
    Sse(SseState),
}

struct SseState {
    endpoint: String,
    response: reqwest::Response,
    buffer: String,
}

struct SseEvent {
    event: Option<String>,
    data: String,
}

enum StreamableError {
    Unsupported(String),
    Failed(String),
}

impl HttpClientTransport {
    pub fn new(url: &str, headers: HashMap<String, String>) -> Self {
        Self {
            url: url.to_string(),
            headers,
            client: reqwest::Client::new(),
            mode: Mutex::new(HttpMode::Unknown),
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
        let mut mode = self.mode.lock().await;
        match &mut *mode {
            HttpMode::Streamable => self
                .send_streamable_request(id, method, params)
                .await
                .map_err(StreamableError::into_message),
            HttpMode::Sse(state) => self.send_sse_request(state, id, method, params).await,
            HttpMode::Unknown => match self
                .send_streamable_request(id, method, params.clone())
                .await
            {
                Ok(value) => {
                    *mode = HttpMode::Streamable;
                    Ok(value)
                }
                Err(StreamableError::Unsupported(_)) => {
                    let mut state = self.open_sse().await?;
                    let value = self
                        .send_sse_request(&mut state, id, method, params)
                        .await?;
                    *mode = HttpMode::Sse(state);
                    Ok(value)
                }
                Err(StreamableError::Failed(message)) => Err(message),
            },
        }
    }

    async fn send_streamable_request(
        &self,
        id: i64,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, StreamableError> {
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
            .map_err(|e| StreamableError::Unsupported(format!("HTTP request failed: {e}")))?;

        let status = response.status();
        if !status.is_success() {
            return if is_streamable_unsupported_status(status) {
                Err(StreamableError::Unsupported(format!(
                    "Streamable HTTP unsupported: {status}"
                )))
            } else {
                Err(StreamableError::Failed(format!(
                    "HTTP request failed: {status}"
                )))
            };
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if content_type.contains("text/event-stream") {
            let mut response = response;
            let mut buffer = String::new();
            read_sse_jsonrpc_response(&mut response, &mut buffer, Some(id))
                .await
                .map_err(StreamableError::Failed)
        } else {
            // JSON response
            let body = response.json::<Value>().await.map_err(|e| {
                StreamableError::Unsupported(format!(
                    "Failed to parse JSON response ({status}): {e}"
                ))
            })?;

            if let Some(error) = body.get("error") {
                let msg = error
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                return Err(StreamableError::Failed(msg.to_string()));
            }
            Ok(body.get("result").cloned().unwrap_or(Value::Null))
        }
    }

    pub async fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let mut mode = self.mode.lock().await;
        match &mut *mode {
            HttpMode::Streamable => self
                .send_streamable_notification(method, params)
                .await
                .map_err(StreamableError::into_message),
            HttpMode::Sse(state) => self.send_sse_notification(state, method, params).await,
            HttpMode::Unknown => match self
                .send_streamable_notification(method, params.clone())
                .await
            {
                Ok(()) => {
                    *mode = HttpMode::Streamable;
                    Ok(())
                }
                Err(StreamableError::Unsupported(_)) => {
                    let mut state = self.open_sse().await?;
                    self.send_sse_notification(&mut state, method, params)
                        .await?;
                    *mode = HttpMode::Sse(state);
                    Ok(())
                }
                Err(StreamableError::Failed(message)) => Err(message),
            },
        }
    }

    async fn send_streamable_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), StreamableError> {
        let request_body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params.unwrap_or(Value::Null),
        });

        let mut builder = self.client.post(&self.url);
        for (key, value) in &self.headers {
            builder = builder.header(key, value);
        }
        let response = builder
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2024-11-05")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| StreamableError::Unsupported(format!("HTTP notification failed: {e}")))?;
        if !response.status().is_success() {
            return if is_streamable_unsupported_status(response.status()) {
                Err(StreamableError::Unsupported(format!(
                    "Streamable HTTP unsupported: {}",
                    response.status()
                )))
            } else {
                Err(StreamableError::Failed(format!(
                    "HTTP notification failed: {}",
                    response.status()
                )))
            };
        }
        Ok(())
    }

    async fn open_sse(&self) -> Result<SseState, String> {
        let mut builder = self.client.get(&self.url);
        for (key, value) in &self.headers {
            builder = builder.header(key, value);
        }
        let response = builder
            .header("accept", "text/event-stream")
            .header("mcp-protocol-version", "2024-11-05")
            .send()
            .await
            .map_err(|e| format!("SSE connection failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("SSE connection failed: {}", response.status()));
        }

        let mut state = SseState {
            endpoint: String::new(),
            response,
            buffer: String::new(),
        };
        loop {
            let event = read_next_sse_event(&mut state.response, &mut state.buffer).await?;
            if event.event.as_deref() == Some("endpoint") {
                state.endpoint = resolve_sse_endpoint(&self.url, &event.data)?;
                return Ok(state);
            }
        }
    }

    async fn send_sse_request(
        &self,
        state: &mut SseState,
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
        self.post_sse_message(state, &request_body).await?;
        read_sse_jsonrpc_response(&mut state.response, &mut state.buffer, Some(id)).await
    }

    async fn send_sse_notification(
        &self,
        state: &mut SseState,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let request_body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params.unwrap_or(Value::Null),
        });
        self.post_sse_message(state, &request_body).await
    }

    async fn post_sse_message(&self, state: &SseState, message: &Value) -> Result<(), String> {
        let mut builder = self.client.post(&state.endpoint);
        for (key, value) in &self.headers {
            builder = builder.header(key, value);
        }
        let response = builder
            .header("accept", "application/json")
            .header("mcp-protocol-version", "2024-11-05")
            .json(message)
            .send()
            .await
            .map_err(|e| format!("SSE message post failed: {e}"))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("SSE message post failed: {}", response.status()))
        }
    }
}

impl StreamableError {
    fn into_message(self) -> String {
        match self {
            StreamableError::Unsupported(message) | StreamableError::Failed(message) => message,
        }
    }
}

fn is_streamable_unsupported_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 400 | 404 | 405 | 406 | 415)
}

async fn read_sse_jsonrpc_response(
    response: &mut reqwest::Response,
    buffer: &mut String,
    expected_id: Option<i64>,
) -> Result<Value, String> {
    loop {
        let event = read_next_sse_event(response, buffer).await?;
        if event
            .event
            .as_deref()
            .is_some_and(|event| event != "message")
        {
            continue;
        }
        let parsed: Value =
            serde_json::from_str(&event.data).map_err(|e| format!("Invalid SSE data JSON: {e}"))?;
        if let Some(expected_id) = expected_id {
            if parsed.get("id").and_then(|v| v.as_i64()) != Some(expected_id) {
                continue;
            }
        }
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

async fn read_next_sse_event(
    response: &mut reqwest::Response,
    buffer: &mut String,
) -> Result<SseEvent, String> {
    loop {
        if let Some(event) = take_sse_event(buffer) {
            return Ok(event);
        }
        let chunk = tokio::time::timeout(Duration::from_secs(30), response.chunk())
            .await
            .map_err(|_| "SSE response timed out".to_string())?
            .map_err(|e| format!("Failed to read SSE response: {e}"))?;
        let Some(chunk) = chunk else {
            return Err("SSE stream closed before a response event".to_string());
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn take_sse_event(buffer: &mut String) -> Option<SseEvent> {
    loop {
        let (index, delimiter_len) = find_sse_event_boundary(buffer)?;
        let raw = buffer[..index].to_string();
        buffer.drain(..index + delimiter_len);
        if let Some(event) = parse_sse_event(&raw) {
            return Some(event);
        }
    }
}

fn find_sse_event_boundary(buffer: &str) -> Option<(usize, usize)> {
    [("\r\n\r\n", 4), ("\n\n", 2)]
        .into_iter()
        .filter_map(|(delimiter, len)| buffer.find(delimiter).map(|index| (index, len)))
        .min_by_key(|(index, _)| *index)
}

fn parse_sse_event(raw: &str) -> Option<SseEvent> {
    let mut event = None;
    let mut data = Vec::new();
    for line in raw.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some(value) = line.strip_prefix("event:") {
            event = Some(value.trim_start().to_string());
        } else if let Some(value) = line.strip_prefix("data:") {
            data.push(value.trim_start().to_string());
        }
    }
    if data.is_empty() {
        None
    } else {
        Some(SseEvent {
            event,
            data: data.join("\n"),
        })
    }
}

fn resolve_sse_endpoint(base_url: &str, endpoint: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(base_url).map_err(|e| format!("Invalid SSE URL: {e}"))?;
    parsed
        .join(endpoint)
        .map(|url| url.to_string())
        .map_err(|e| format!("Invalid SSE endpoint: {e}"))
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::StatusCode,
        response::{sse::Event, IntoResponse, Sse},
        routing::{get, post},
        Json, Router,
    };
    use futures::{stream::Stream, StreamExt};
    use std::convert::Infallible;
    use std::sync::Arc;
    use tokio::sync::{mpsc, Mutex};

    #[derive(Clone)]
    struct SseTestState {
        sender: mpsc::UnboundedSender<Value>,
        receiver: Arc<Mutex<Option<mpsc::UnboundedReceiver<Value>>>>,
    }

    async fn sse_endpoint(
        State(state): State<SseTestState>,
    ) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
        let receiver = state
            .receiver
            .lock()
            .await
            .take()
            .expect("test opens one SSE stream");
        let endpoint = futures::stream::once(async {
            Ok(Event::default().event("endpoint").data("/messages"))
        });
        let messages =
            tokio_stream::wrappers::UnboundedReceiverStream::new(receiver).map(|value| {
                Ok(Event::default()
                    .event("message")
                    .data(serde_json::to_string(&value).expect("json response should serialize")))
            });
        Sse::new(endpoint.chain(messages))
    }

    async fn message_endpoint(
        State(state): State<SseTestState>,
        Json(body): Json<Value>,
    ) -> impl IntoResponse {
        let id = body.get("id").cloned().unwrap_or(Value::Null);
        state
            .sender
            .send(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "ok": true }
            }))
            .expect("sse response should be queued");
        StatusCode::ACCEPTED
    }

    async fn streamable_unsupported() -> impl IntoResponse {
        StatusCode::METHOD_NOT_ALLOWED
    }

    #[test]
    fn sse_parser_skips_comments_and_accepts_crlf_delimiters() {
        let mut buffer =
            ": keep-alive\r\n\r\nevent: endpoint\r\ndata: /messages\r\n\r\n".to_string();

        let event = take_sse_event(&mut buffer).expect("endpoint event should parse");

        assert_eq!(event.event.as_deref(), Some("endpoint"));
        assert_eq!(event.data, "/messages");
        assert!(buffer.is_empty());
    }

    #[tokio::test]
    async fn request_falls_back_to_legacy_sse_transport() {
        let (sender, receiver) = mpsc::unbounded_channel();
        let state = SseTestState {
            sender,
            receiver: Arc::new(Mutex::new(Some(receiver))),
        };
        let app = Router::new()
            .route("/sse", get(sse_endpoint).post(streamable_unsupported))
            .route("/messages", post(message_endpoint))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("failed to bind test server");
        let addr = listener.local_addr().expect("failed to read local addr");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test server failed");
        });

        let transport = HttpClientTransport::new(&format!("http://{addr}/sse"), HashMap::new());
        let result = transport
            .send_request(1, "initialize", Some(serde_json::json!({})))
            .await
            .expect("SSE fallback request should succeed");

        assert_eq!(result["ok"], true);
        server.abort();
    }
}
