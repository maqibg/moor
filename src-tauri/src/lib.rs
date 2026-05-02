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
}

impl SidecarState {
    fn new(api_token: String, data_dir: PathBuf, legacy_data_dir: Option<PathBuf>) -> Self {
        Self {
            inner: Arc::new(SidecarInner {
                info: Mutex::new(None),
                child: Mutex::new(None),
                api_token,
                data_dir,
                legacy_data_dir,
                restart_count: AtomicUsize::new(0),
                shutting_down: AtomicBool::new(false),
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
        if let Ok(mut guard) = self.inner.child.lock() {
            *guard = Some(child);
        }
    }

    fn should_restart(&self) -> bool {
        !self.inner.shutting_down.load(Ordering::SeqCst)
            && self.inner.restart_count.fetch_add(1, Ordering::SeqCst) < 3
    }

    fn stop(&self) {
        self.inner.shutting_down.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.inner.child.lock() {
            if let Some(child) = guard.take() {
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

fn spawn_sidecar(app: &AppHandle, state: SidecarState) -> Result<(), String> {
    fs::create_dir_all(&state.inner.data_dir).map_err(|err| err.to_string())?;
    state.set_info(None);

    let mut args = vec![
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        "9223".to_string(),
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
                    state_for_events.set_info(None);
                    if state_for_events.should_restart() {
                        let app_for_restart = app_handle.clone();
                        let state_for_restart = state_for_events.clone();
                        tauri::async_runtime::spawn(async move {
                            thread::sleep(Duration::from_secs(1));
                            if let Err(error) = spawn_sidecar(&app_for_restart, state_for_restart) {
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
        .invoke_handler(tauri::generate_handler![get_sidecar_info])
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
            let sidecar_state = SidecarState::new(generate_api_token(), data_dir, legacy_data_dir);
            app.manage(sidecar_state.clone());
            spawn_sidecar(app.handle(), sidecar_state)
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
                    api.prevent_close();
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }
            _ => {}
        });
}
