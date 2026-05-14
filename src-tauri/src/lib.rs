use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, State,
};

mod login_autostart;
mod sidecar;

const LEGACY_BUNDLE_IDENTIFIER: &str = "dev.moor.app";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarInfo {
    port: u16,
    base_url: String,
    api_token: String,
}

fn should_show_main_window_on_launch(
    minimize_to_tray_on_close: bool,
    show_window_on_launch: bool,
) -> bool {
    !minimize_to_tray_on_close || show_window_on_launch
}

fn read_settings_file(data_dir: &Path) -> sidecar::services::settings::Settings {
    sidecar::services::settings::read_settings_file(data_dir)
}

fn generate_api_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("Failed to generate API token: {e}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[derive(Clone)]
struct MoorState {
    inner: Arc<MoorInner>,
}

struct MoorInner {
    port: u16,
    api_token: String,
    data_dir: PathBuf,
    minimize_to_tray: AtomicBool,
}

impl MoorState {
    fn info(&self) -> SidecarInfo {
        SidecarInfo {
            port: self.inner.port,
            base_url: format!("http://127.0.0.1:{}", self.inner.port),
            api_token: self.inner.api_token.clone(),
        }
    }

    fn get_minimize_to_tray(&self) -> bool {
        self.inner.minimize_to_tray.load(Ordering::SeqCst)
    }

    fn set_minimize_to_tray(&self, value: bool) {
        self.inner.minimize_to_tray.store(value, Ordering::SeqCst);
    }
}

#[tauri::command]
fn get_sidecar_info(state: State<'_, MoorState>) -> Result<SidecarInfo, String> {
    Ok(state.info())
}

fn apply_autostart_setting(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    login_autostart::validate_login_autostart_enable(enabled)?;
    let should_reload_login_agent = enabled && login_autostart::login_agent_needs_reload(app);
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|err| err.to_string())?;
        if should_reload_login_agent {
            login_autostart::refresh_stale_login_agent(app);
        }
        Ok(())
    } else {
        autolaunch.disable().map_err(|err| err.to_string())
    }
}

fn sync_runtime_settings_from_file(state: &MoorState, data_dir: &Path) -> Result<(), String> {
    let settings = read_settings_file(data_dir);
    let minimize_to_tray = settings.general.minimize_to_tray_on_close;
    state.set_minimize_to_tray(minimize_to_tray);
    Ok(())
}

#[tauri::command]
fn sync_runtime_settings(state: State<'_, MoorState>) -> Result<(), String> {
    sync_runtime_settings_from_file(&state, &state.inner.data_dir)
}

#[tauri::command]
fn apply_login_autostart_setting(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    apply_autostart_setting(&app, enabled)
}

#[tauri::command]
fn restart_sidecar() -> Result<(), String> {
    Err("The Rust sidecar runs in-process. Restart Moor to apply runtime port changes.".to_string())
}

fn find_available_port(host: &str, start: u16, max: u16) -> Result<u16, String> {
    for port in start..=max {
        if std::net::TcpListener::bind((host, port)).is_ok() {
            return Ok(port);
        }
    }
    Err(format!("No available port in range {start}-{max}"))
}

fn migrate_legacy_data_dir(data_dir: &PathBuf, legacy_data_dir: Option<&PathBuf>) {
    let Some(legacy) = legacy_data_dir else {
        return;
    };
    if data_dir == legacy {
        return;
    };
    let _ = fs::create_dir_all(data_dir);

    let current_settings = data_dir.join("settings.json");
    let legacy_settings = legacy.join("settings.json");
    if !current_settings.exists() && legacy_settings.exists() {
        let _ = fs::copy(&legacy_settings, current_settings);
    }

    let current_db = data_dir.join("moor.db");
    let legacy_db = legacy.join("moor.db");
    if current_db.exists() || !legacy_db.exists() {
        return;
    };
    for name in &["moor.db", "moor.db-wal", "moor.db-shm"] {
        let src = legacy.join(name);
        if src.exists() {
            let _ = fs::copy(&src, data_dir.join(name));
        }
    }
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
            apply_login_autostart_setting,
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

            // Legacy data migration
            migrate_legacy_data_dir(&data_dir, legacy_data_dir.as_ref());

            // Read settings after migration so the runtime and HTTP API share settings.json.
            let settings = read_settings_file(&data_dir);
            sidecar::services::settings::write_settings_file(&data_dir, &settings)
                .map_err(|e| format!("Failed to initialize settings: {e}"))?;
            let configured_port = settings.advanced.sidecar_port;
            let minimize_to_tray = settings.general.minimize_to_tray_on_close;
            let show_window_on_launch = settings.general.show_window_on_launch;
            let should_show_window =
                should_show_main_window_on_launch(minimize_to_tray, show_window_on_launch);
            let auto_start = settings.general.auto_start_on_login;

            // Init database
            fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
            let db_path = data_dir.join("moor.db");
            let db = sidecar::db::Database::open(&db_path)
                .map_err(|e| format!("Failed to open database: {e}"))?;
            db.run_migrations()
                .map_err(|e| format!("Failed to run migrations: {e}"))?;

            // Seed default profile
            let profile_repo = sidecar::db::profile_repo::ProfileRepository::new(&db);
            profile_repo
                .seed_default()
                .map_err(|e| format!("Failed to seed default profile: {e}"))?;

            // Reset running statuses (crash recovery)
            let server_repo = sidecar::db::server_repo::ServerRepository::new(&db);
            server_repo
                .reset_running_statuses()
                .map_err(|e| format!("Failed to reset statuses: {e}"))?;

            // Find available port
            let api_token = generate_api_token()?;
            let max_port = configured_port.saturating_add(10);
            let port = find_available_port("127.0.0.1", configured_port, max_port)
                .map_err(|e| format!("Failed to find available port: {e}"))?;

            // Write port file for external tool discovery
            let port_file = data_dir.join("port");
            let _ = fs::write(&port_file, port.to_string());
            let pid_file = data_dir.join("pid");
            let _ = fs::write(&pid_file, std::process::id().to_string());

            // Build app state and start in-process HTTP server
            let db_arc = Arc::new(db);
            let event_bus = Arc::new(sidecar::services::event_bus::EventBus::new(256));
            let server_manager = Arc::new(sidecar::services::server_manager::ServerManager::new(
                db_arc.clone(),
                event_bus.clone(),
            ));
            let app_state = Arc::new(sidecar::http::AppState {
                db: db_arc,
                api_token: api_token.clone(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                port,
                data_dir: data_dir.clone(),
                event_bus: event_bus.clone(),
                server_manager: server_manager.clone(),
            });

            let state = MoorState {
                inner: Arc::new(MoorInner {
                    port,
                    api_token,
                    data_dir: data_dir.clone(),
                    minimize_to_tray: AtomicBool::new(minimize_to_tray),
                }),
            };
            app.manage(state);

            // Spawn axum server
            let host = "127.0.0.1".to_string();
            let sm = server_manager.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = sidecar::http::start_server(app_state, &host, port).await {
                    eprintln!("HTTP server error: {e}");
                }
            });

            // Load servers and start auto-start servers
            tauri::async_runtime::spawn(async move {
                sm.load_from_db().await;
                sm.start_auto_start_servers().await;
            });

            let _ = apply_autostart_setting(app.handle(), auto_start);

            // Tray menu
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
                // Server will be dropped automatically when the process exits
            }
            RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { api, .. },
                label,
                ..
            } if label == "main" => {
                let state = app_handle.state::<MoorState>();
                if state.get_minimize_to_tray() {
                    api.prevent_close();
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::SystemTime};

    fn temp_data_dir(test_name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moor-{test_name}-{timestamp}"))
    }

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
        let state = MoorState {
            inner: Arc::new(MoorInner {
                port: 9223,
                api_token: "token".to_string(),
                data_dir: PathBuf::from("."),
                minimize_to_tray: AtomicBool::new(true),
            }),
        };
        state.set_minimize_to_tray(false);
        assert!(!state.get_minimize_to_tray());
    }

    #[test]
    fn sync_runtime_settings_only_updates_window_runtime_state() {
        let data_dir = temp_data_dir("runtime-settings");
        fs::create_dir_all(&data_dir).expect("failed to create temp settings dir");
        fs::write(
            data_dir.join("settings.json"),
            r#"{
              "general": {
                "autoStartOnLogin": true,
                "minimizeToTrayOnClose": false
              }
            }"#,
        )
        .expect("failed to write temp settings file");

        let state = MoorState {
            inner: Arc::new(MoorInner {
                port: 9223,
                api_token: "token".to_string(),
                data_dir: data_dir.clone(),
                minimize_to_tray: AtomicBool::new(true),
            }),
        };

        sync_runtime_settings_from_file(&state, &data_dir).expect("runtime settings sync failed");
        assert!(!state.get_minimize_to_tray());
        fs::remove_dir_all(data_dir).expect("failed to remove temp settings dir");
    }

    #[test]
    fn finds_available_port() {
        let port = find_available_port("127.0.0.1", 19223, 19233).unwrap();
        assert!((19223..=19233).contains(&port));
    }
}
