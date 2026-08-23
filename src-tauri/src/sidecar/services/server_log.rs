// Per-server 启动日志:<logs_dir>/<server_id>.log,每次启动尝试截断重写。
// 生命周期事件(启动/失败/退出)由 ServerManager 写入;stdio stderr 由
// StdioClientTransport 追加到同一文件。约定:写入失败一律由调用方 `let _ =`
// 吞掉——日志绝不能影响 server 启动流程。

use std::io::Write;
use std::path::{Path, PathBuf};

pub fn log_path(logs_dir: &Path, server_id: &str) -> PathBuf {
    logs_dir.join(format!("{server_id}.log"))
}

/// 截断重建日志文件并写入启动尝试标记,返回文件路径。
pub fn begin_attempt(
    logs_dir: &Path,
    server_id: &str,
    command_line: &str,
) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(logs_dir)?;
    let path = log_path(logs_dir, server_id);
    let mut file = std::fs::File::create(&path)?;
    writeln!(
        file,
        "[{}] === Start attempt: {} ===",
        timestamp(),
        command_line
    )?;
    Ok(path)
}

/// create 兜底:文件可能因 begin_attempt 失败或运行中被删除而缺失,事件不应因此丢失。
pub fn append_event(path: &Path, message: &str) -> std::io::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(path)?;
    writeln!(file, "[{}] {}", timestamp(), message)
}

pub fn timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
