use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, State,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const LEGACY_BUNDLE_IDENTIFIER: &str = "dev.moor.app";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarInfo {
    port: u16,
    base_url: String,
    api_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyPayload {
    port: u16,
    base_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsFile {
    #[serde(default)]
    general: GeneralSettingsFile,
    #[serde(default)]
    advanced: AdvancedSettingsFile,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GeneralSettingsFile {
    #[serde(default)]
    minimize_to_tray_on_close: Option<bool>,
    #[serde(default)]
    show_window_on_launch: Option<bool>,
    #[serde(default)]
    auto_start_on_login: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AdvancedSettingsFile {
    #[serde(default = "default_port")]
    sidecar_port: Option<u16>,
}

fn default_port() -> Option<u16> {
    Some(9223)
}

impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            general: GeneralSettingsFile::default(),
            advanced: AdvancedSettingsFile::default(),
        }
    }
}

fn read_settings_file(data_dir: &PathBuf) -> SettingsFile {
    let path = data_dir.join("settings.json");
    if !path.exists() {
        return SettingsFile::default();
    }
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => SettingsFile::default(),
    }
}

fn should_show_main_window_on_launch(
    minimize_to_tray_on_close: bool,
    show_window_on_launch: bool,
) -> bool {
    !minimize_to_tray_on_close || show_window_on_launch
}

#[cfg(test)]
mod tests {
    use super::{should_show_main_window_on_launch, SidecarState};
    use std::path::PathBuf;

    #[test]
    fn shows_window_for_default_settings() {
        assert!(should_show_main_window_on_launch(true, true));
    }

    #[test]
    fn hides_window_when_tray_mode_disables_launch_window() {
        assert!(!should_show_main_window_on_launch(true, false));
    }

    #[test]
    fn shows_window_when_minimize_to_tray_is_disabled() {
        assert!(should_show_main_window_on_launch(false, false));
    }

    #[test]
    fn updates_minimize_to_tray_runtime_state() {
        let state = SidecarState::new("token".to_string(), PathBuf::from("."), None, true);

        state.set_minimize_to_tray(false);

        assert!(!state.get_minimize_to_tray());
    }
}

#[derive(Clone)]
struct SidecarState {
    inner: Arc<SidecarInner>,
}

struct SidecarInner {
    info: Mutex<Option<SidecarInfo>>,
    child: Mutex<Option<CommandChild>>,
    api_token: String,
    data_dir: PathBuf,
    legacy_data_dir: Option<PathBuf>,
    restart_count: AtomicUsize,
    shutting_down: AtomicBool,
    terminated_child_pid: Mutex<Option<u32>>,
    minimize_to_tray: AtomicBool,
}

impl SidecarState {
    fn new(
        api_token: String,
        data_dir: PathBuf,
        legacy_data_dir: Option<PathBuf>,
        minimize_to_tray: bool,
    ) -> Self {
        Self {
            inner: Arc::new(SidecarInner {
                info: Mutex::new(None),
                child: Mutex::new(None),
                api_token,
                data_dir,
                legacy_data_dir,
                restart_count: AtomicUsize::new(0),
                shutting_down: AtomicBool::new(false),
                terminated_child_pid: Mutex::new(None),
                minimize_to_tray: AtomicBool::new(minimize_to_tray),
            }),
        }
    }

    fn info(&self) -> Option<SidecarInfo> {
        self.inner.info.lock().ok().and_then(|info| info.clone())
    }

    fn set_info(&self, info: Option<SidecarInfo>) {
        if let Ok(mut guard) = self.inner.info.lock() {
            *guard = info;
        }
    }

    fn set_child(&self, child: CommandChild) {
        if let Ok(mut terminated_pid) = self.inner.terminated_child_pid.lock() {
            *terminated_pid = None;
        }
        if let Ok(mut guard) = self.inner.child.lock() {
            *guard = Some(child);
        }
    }

    fn mark_child_terminated(&self, pid: u32) {
        if let Ok(mut terminated_pid) = self.inner.terminated_child_pid.lock() {
            *terminated_pid = Some(pid);
        }
    }

    fn is_child_terminated(&self, pid: u32) -> bool {
        self.inner
            .terminated_child_pid
            .lock()
            .map(|terminated_pid| *terminated_pid == Some(pid))
            .unwrap_or(false)
    }

    fn should_restart(&self) -> bool {
        !self.inner.shutting_down.load(Ordering::SeqCst)
            && self.inner.restart_count.fetch_add(1, Ordering::SeqCst) < 3
    }

    fn get_minimize_to_tray(&self) -> bool {
        self.inner.minimize_to_tray.load(Ordering::SeqCst)
    }

    fn set_minimize_to_tray(&self, value: bool) {
        self.inner.minimize_to_tray.store(value, Ordering::SeqCst);
    }

    fn stop(&self) {
        self.inner.shutting_down.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.inner.child.lock() {
            if let Some(child) = guard.take() {
                #[cfg(unix)]
                {
                    let pid = child.pid();
                    let _ = std::process::Command::new("kill")
                        .args(["-s", "TERM", &pid.to_string()])
                        .status();
                    let start = std::time::Instant::now();
                    while start.elapsed() < Duration::from_secs(3) {
                        if self.is_child_terminated(pid) {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(200));
                    }
                    if self.is_child_terminated(pid) {
                        return;
                    }
                }
                let _ = child.kill();
            }
        }
    }
}

#[tauri::command]
fn get_sidecar_info(state: State<'_, SidecarState>) -> Result<SidecarInfo, String> {
    for _ in 0..50 {
        if let Some(info) = state.info() {
            return Ok(info);
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("Moor sidecar is not ready".to_string())
}

fn apply_autostart_setting(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|err| err.to_string())
    } else {
        autolaunch.disable().map_err(|err| err.to_string())
    }
}

fn sync_runtime_settings_from_file(app: &AppHandle, state: &SidecarState) -> Result<(), String> {
    let settings = read_settings_file(&state.inner.data_dir);
    let minimize_to_tray = settings.general.minimize_to_tray_on_close.unwrap_or(true);
    let auto_start = settings.general.auto_start_on_login.unwrap_or(false);

    state.set_minimize_to_tray(minimize_to_tray);
    apply_autostart_setting(app, auto_start)
}

#[tauri::command]
fn sync_runtime_settings(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
    sync_runtime_settings_from_file(&app, &state)
}

#[tauri::command]
fn restart_sidecar(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
    let state = (*state).clone();
    state.stop();
    state.inner.shutting_down.store(false, Ordering::SeqCst);
    state.inner.restart_count.store(0, Ordering::SeqCst);
    thread::sleep(Duration::from_millis(500));

    // Re-read settings for potentially updated port
    let settings = read_settings_file(&state.inner.data_dir);
    let port = settings.advanced.sidecar_port.unwrap_or(9223);
    spawn_sidecar_with_port(&app, state, port)
}

fn generate_api_token() -> String {
    let mut bytes = [0u8; 32];
    if File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_err()
    {
        let fallback = format!("{:?}{:?}", std::time::SystemTime::now(), std::process::id());
        let fallback_bytes = fallback.as_bytes();
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = fallback_bytes[index % fallback_bytes.len()];
        }
    }

    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parse_ready_line(line: &str, api_token: &str) -> Option<SidecarInfo> {
    let payload = line.trim().strip_prefix("MOOR_READY ")?;
    let ready = serde_json::from_str::<ReadyPayload>(payload).ok()?;
    Some(SidecarInfo {
        port: ready.port,
        base_url: ready.base_url,
        api_token: api_token.to_string(),
    })
}

fn spawn_sidecar_with_port(app: &AppHandle, state: SidecarState, port: u16) -> Result<(), String> {
    fs::create_dir_all(&state.inner.data_dir).map_err(|err| err.to_string())?;
    state.set_info(None);

    let mut args = vec![
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--api-token".to_string(),
        state.inner.api_token.clone(),
        "--data-dir".to_string(),
        state.inner.data_dir.to_string_lossy().to_string(),
    ];
    if let Some(legacy_data_dir) = &state.inner.legacy_data_dir {
        args.push("--legacy-data-dir".to_string());
        args.push(legacy_data_dir.to_string_lossy().to_string());
    }

    let (mut rx, child) = app
        .shell()
        .sidecar("moor-sidecar")
        .map_err(|err| err.to_string())?
        .args(args)
        .spawn()
        .map_err(|err| err.to_string())?;
    let child_pid = child.pid();
    state.set_child(child);

    let app_handle = app.clone();
    let state_for_events = state.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    if let Ok(line) = String::from_utf8(bytes) {
                        if let Some(info) =
                            parse_ready_line(&line, &state_for_events.inner.api_token)
                        {
                            state_for_events.set_info(Some(info));
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    if let Ok(line) = String::from_utf8(bytes) {
                        eprint!("{line}");
                    }
                }
                CommandEvent::Error(error) => eprintln!("Moor sidecar error: {error}"),
                CommandEvent::Terminated(_) => {
                    state_for_events.mark_child_terminated(child_pid);
                    state_for_events.set_info(None);
                    if state_for_events.should_restart() {
                        let app_for_restart = app_handle.clone();
                        let state_for_restart = state_for_events.clone();
                        tauri::async_runtime::spawn(async move {
                            thread::sleep(Duration::from_secs(1));
                            // Re-read settings for potentially updated port
                            let settings = read_settings_file(&state_for_restart.inner.data_dir);
                            let port = settings.advanced.sidecar_port.unwrap_or(9223);
                            if let Err(error) =
                                spawn_sidecar_with_port(&app_for_restart, state_for_restart, port)
                            {
                                eprintln!("Failed to restart Moor sidecar: {error}");
                            }
                        });
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![
            get_sidecar_info,
            restart_sidecar,
            sync_runtime_settings,
        ])
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from(".moor"));
            let legacy_data_dir = app
                .path()
                .data_dir()
                .ok()
                .map(|dir| dir.join(LEGACY_BUNDLE_IDENTIFIER));

            // Read settings before spawning sidecar
            let settings = read_settings_file(&data_dir);
            let port = settings.advanced.sidecar_port.unwrap_or(9223);
            let minimize_to_tray = settings.general.minimize_to_tray_on_close.unwrap_or(true);
            let show_window_on_launch = settings.general.show_window_on_launch.unwrap_or(true);
            let should_show_window =
                should_show_main_window_on_launch(minimize_to_tray, show_window_on_launch);
            let auto_start = settings.general.auto_start_on_login.unwrap_or(false);

            let sidecar_state = SidecarState::new(
                generate_api_token(),
                data_dir,
                legacy_data_dir,
                minimize_to_tray,
            );
            app.manage(sidecar_state.clone());

            let _ = apply_autostart_setting(app.handle(), auto_start);

            spawn_sidecar_with_port(app.handle(), sidecar_state, port)
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;

            let quit = MenuItem::with_id(app, "quit", "Quit Moor", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(tauri::include_image!("./icons/tray-template.png"))
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Moor - MCP Manager")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            if should_show_window {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::Exit | RunEvent::ExitRequested { .. } => {
                app_handle.state::<SidecarState>().stop();
            }
            RunEvent::WindowEvent { event, label, .. } if label == "main" => {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let state = app_handle.state::<SidecarState>();
                    if state.get_minimize_to_tray() {
                        api.prevent_close();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    // If minimize_to_tray is false, the window closes normally (app exits)
                }
            }
            _ => {}
        });
}
