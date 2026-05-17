use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

type PendingMap = Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>;

pub struct StdioClientTransport {
    child: Option<Child>,
    stdin_handle: Arc<AsyncMutex<Option<tokio::process::ChildStdin>>>,
    pending: PendingMap,
    next_id: Arc<Mutex<i64>>,
    reader_handle: Option<tokio::task::JoinHandle<()>>,
}

impl StdioClientTransport {
    pub async fn spawn(
        command: &str,
        args: &[String],
        cwd: Option<&str>,
        env: HashMap<String, String>,
    ) -> Result<Self, String> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .envs(&env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        if let Some(cwd) = cwd {
            cmd.current_dir(cwd);
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {e}"))?;
        let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let stdin_handle = Arc::new(AsyncMutex::new(Some(stdin)));

        // stdout reader task
        let pending_clone = pending.clone();
        let reader_handle = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let line = line.trim().to_string();
                        if line.is_empty() {
                            continue;
                        }
                        let parsed: Value = match serde_json::from_str(&line) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        if let Some(id) = parsed.get("id").and_then(|v| v.as_i64()) {
                            let sender = {
                                let mut map = pending_clone.lock().unwrap();
                                map.remove(&id)
                            };
                            if let Some(sender) = sender {
                                let _ = sender.send(parsed);
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        });

        // stderr reader task
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::warn!(target: "mcp::stdio::stderr", "{}", line);
            }
        });

        Ok(Self {
            child: Some(child),
            stdin_handle,
            pending,
            next_id: Arc::new(Mutex::new(1)),
            reader_handle: Some(reader_handle),
        })
    }

    pub async fn send_request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = {
            let mut next = self.next_id.lock().unwrap();
            let id = *next;
            *next += 1;
            id
        };

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params.unwrap_or(Value::Null),
        });

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().unwrap();
            map.insert(id, tx);
        }

        let msg = format!("{}\n", serde_json::to_string(&request).unwrap_or_default());
        {
            let mut stdin_opt = self.stdin_handle.lock().await;
            let stdin = stdin_opt.as_mut().ok_or("stdin closed")?;
            stdin
                .write_all(msg.as_bytes())
                .await
                .map_err(|e| format!("stdin write failed: {e}"))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("stdin flush failed: {e}"))?;
        }

        match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
            Ok(Ok(response)) => {
                if let Some(error) = response.get("error") {
                    let msg = error
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error");
                    return Err(msg.to_string());
                }
                Ok(response.get("result").cloned().unwrap_or(Value::Null))
            }
            Ok(Err(_)) => Err("response channel closed".into()),
            Err(_) => {
                let mut map = self.pending.lock().unwrap();
                map.remove(&id);
                Err("request timed out (30s)".into())
            }
        }
    }

    pub async fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params.unwrap_or(Value::Null),
        });
        let msg = format!(
            "{}\n",
            serde_json::to_string(&notification).unwrap_or_default()
        );
        let mut stdin_opt = self.stdin_handle.lock().await;
        let stdin = stdin_opt.as_mut().ok_or("stdin closed")?;
        stdin
            .write_all(msg.as_bytes())
            .await
            .map_err(|e| format!("stdin write failed: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("stdin flush failed: {e}"))
    }

    pub async fn close(&mut self) -> Result<(), String> {
        {
            let mut stdin_opt = self.stdin_handle.lock().await;
            *stdin_opt = None;
        }
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        if let Some(handle) = self.reader_handle.take() {
            handle.abort();
        }
        {
            let mut map = self.pending.lock().unwrap();
            map.clear();
        }
        Ok(())
    }
}

/// Build the environment for stdio MCP server processes.
pub fn build_stdio_environment(
    parent_env: &HashMap<String, String>,
    server_env: Option<&HashMap<String, String>>,
) -> HashMap<String, String> {
    let is_windows = cfg!(windows);
    let mut env = parent_env.clone();
    if let Some(server_env) = server_env {
        env.extend(server_env.iter().map(|(k, v)| (k.clone(), v.clone())));
    }

    let home = env
        .get("HOME")
        .cloned()
        .or_else(|| std::env::var("HOME").ok())
        .or_else(|| std::env::var("USERPROFILE").ok())
        .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "/".to_string());

    #[cfg(unix)]
    let default_candidates: &[&str] = &[
        "~/.local/share/mise/shims",
        "~/.local/bin",
        "~/Library/pnpm",
        "~/.cargo/bin",
        "~/.asdf/shims",
        "~/.volta/bin",
        "~/.bun/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/opt/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];

    #[cfg(windows)]
    let default_candidates: &[&str] = &[
        "~/AppData/Local/pnpm",
        "~/.cargo/bin",
        "~/AppData/Local/Programs",
        "~/AppData/Local/Microsoft/WinGet/Links",
        "~/scoop/shims",
        "~/AppData/Roaming/npm",
    ];

    let default_entries: Vec<String> = default_candidates
        .iter()
        .map(|p| expand_home(p, &home))
        .collect();

    let mut all_entries = Vec::new();
    if let Some(server_path) =
        server_env.and_then(|server_env| path_value_for_platform(server_env, is_windows))
    {
        all_entries.extend(split_path(server_path));
    }
    if let Some(parent_path) = path_value_for_platform(parent_env, is_windows) {
        all_entries.extend(split_path(parent_path));
    }
    all_entries.extend(default_entries);

    let mut seen = std::collections::HashSet::new();
    let unique: Vec<String> = all_entries
        .into_iter()
        .filter(|e| seen.insert(e.clone()))
        .collect();

    let separator = if is_windows { ";" } else { ":" };
    env.insert("PATH".to_string(), unique.join(separator));
    env
}

fn expand_home(path: &str, home: &str) -> String {
    if path == "~" {
        return home.to_string();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return std::path::PathBuf::from(home)
            .join(rest)
            .to_string_lossy()
            .into_owned();
    }
    path.to_string()
}

#[cfg(unix)]
fn split_path(value: &str) -> Vec<String> {
    value
        .split(':')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(windows)]
fn split_path(value: &str) -> Vec<String> {
    value
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn split_windows_path(value: &str) -> Vec<String> {
    value
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn env_value_for_platform<'a>(
    env: &'a HashMap<String, String>,
    key: &str,
    is_windows: bool,
) -> Option<&'a String> {
    env.get(key).or_else(|| {
        is_windows
            .then(|| {
                env.iter()
                    .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
                    .map(|(_, value)| value)
            })
            .flatten()
    })
}

fn path_value_for_platform(env: &HashMap<String, String>, is_windows: bool) -> Option<&String> {
    env_value_for_platform(env, "PATH", is_windows)
}

fn executable_names_for_platform(
    command: &str,
    env: &HashMap<String, String>,
    is_windows: bool,
) -> Vec<String> {
    if !is_windows || std::path::Path::new(command).extension().is_some() {
        return vec![command.to_string()];
    }

    let extensions = env_value_for_platform(env, "PATHEXT", is_windows)
        .map(|value| split_windows_path(value))
        .unwrap_or_else(|| split_windows_path(".EXE;.CMD;.BAT;.COM"));

    std::iter::once(command.to_string())
        .chain(
            extensions
                .into_iter()
                .map(|extension| format!("{command}{}", extension.to_ascii_lowercase())),
        )
        .collect()
}

pub fn find_executable_on_path(command: &str, env: &HashMap<String, String>) -> Option<String> {
    let path = std::path::Path::new(command);
    if path.is_absolute() {
        return if is_executable(command) {
            Some(command.to_string())
        } else {
            None
        };
    }

    if command.contains('/') || command.contains('\\') {
        return None;
    }

    let is_windows = cfg!(windows);
    let path_var = path_value_for_platform(env, is_windows)?;
    let separator = if is_windows { ';' } else { ':' };
    let candidate_names = executable_names_for_platform(command, env, is_windows);
    for dir in path_var.split(separator) {
        for name in &candidate_names {
            let candidate = std::path::PathBuf::from(dir).join(name);
            if is_executable(&candidate.to_string_lossy()) {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[cfg(unix)]
fn is_executable(path: &str) -> bool {
    std::fs::metadata(path)
        .ok()
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &str) -> bool {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if !metadata.is_file() {
        return false;
    }
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(ext.as_str(), "exe" | "cmd" | "bat" | "com")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_path_lookup_accepts_path_alias() {
        let env = HashMap::from([("Path".to_string(), r"C:\Tools".to_string())]);

        assert_eq!(
            path_value_for_platform(&env, true).map(String::as_str),
            Some(r"C:\Tools")
        );
    }

    #[test]
    fn windows_executable_names_expand_pathext_for_extensionless_commands() {
        let env = HashMap::from([("PATHEXT".to_string(), ".EXE;.CMD;.BAT;.COM".to_string())]);

        assert_eq!(
            executable_names_for_platform("npx", &env, true),
            vec!["npx", "npx.exe", "npx.cmd", "npx.bat", "npx.com"]
        );
    }

    #[test]
    fn windows_executable_names_keep_explicit_extension() {
        let env = HashMap::from([("PATHEXT".to_string(), ".EXE;.CMD;.BAT;.COM".to_string())]);

        assert_eq!(
            executable_names_for_platform("npx.cmd", &env, true),
            vec!["npx.cmd"]
        );
    }
}
