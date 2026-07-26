use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
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
const AUTOSTART_ARG: &str = "--moor-autostart";
const LEGACY_MIGRATION_MARKER: &str = ".legacy-migration-complete";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarInfo {
    port: u16,
    base_url: String,
    api_token: String,
    port_fallback_from: Option<u16>,
}

fn should_show_main_window_on_launch(
    minimize_to_tray_on_close: bool,
    show_window_on_launch: bool,
) -> bool {
    !minimize_to_tray_on_close || show_window_on_launch
}

fn should_start_auto_start_servers_on_launch(
    settings: &sidecar::services::settings::Settings,
) -> bool {
    settings.general.auto_start_servers_on_launch
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
    db: Arc<sidecar::db::Database>,
    port_fallback_from: Option<u16>,
    minimize_to_tray: AtomicBool,
    hide_dock_icon_on_close: AtomicBool,
}

impl MoorState {
    fn info(&self) -> SidecarInfo {
        SidecarInfo {
            port: self.inner.port,
            base_url: format!("http://127.0.0.1:{}", self.inner.port),
            api_token: self.inner.api_token.clone(),
            port_fallback_from: self.inner.port_fallback_from,
        }
    }

    fn get_minimize_to_tray(&self) -> bool {
        self.inner.minimize_to_tray.load(Ordering::SeqCst)
    }

    fn set_minimize_to_tray(&self, value: bool) {
        self.inner.minimize_to_tray.store(value, Ordering::SeqCst);
    }

    fn get_hide_dock_icon_on_close(&self) -> bool {
        self.inner.hide_dock_icon_on_close.load(Ordering::SeqCst)
    }

    fn set_hide_dock_icon_on_close(&self, value: bool) {
        self.inner
            .hide_dock_icon_on_close
            .store(value, Ordering::SeqCst);
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

fn show_main_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(true);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn sync_runtime_settings_from_db(
    state: &MoorState,
    db: &sidecar::db::Database,
) -> Result<(), String> {
    let settings = sidecar::services::settings::get_settings(db)?;
    let minimize_to_tray = settings.general.minimize_to_tray_on_close;
    let hide_dock_icon_on_close = settings.general.hide_dock_icon_on_close;
    state.set_minimize_to_tray(minimize_to_tray);
    state.set_hide_dock_icon_on_close(hide_dock_icon_on_close);
    Ok(())
}

#[tauri::command]
fn sync_runtime_settings(state: State<'_, MoorState>) -> Result<(), String> {
    sync_runtime_settings_from_db(&state, state.inner.db.as_ref())
}

#[tauri::command]
fn apply_login_autostart_setting(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    apply_autostart_setting(&app, enabled)
}

fn find_available_port(host: &str, start: u16, max: u16) -> Result<u16, String> {
    for port in start..=max {
        if std::net::TcpListener::bind((host, port)).is_ok() {
            return Ok(port);
        }
    }
    Err(format!("No available port in range {start}-{max}"))
}

fn persist_fallback_port(
    db: &sidecar::db::Database,
    configured_port: u16,
    actual_port: u16,
) -> Result<(), String> {
    if configured_port == actual_port {
        return Ok(());
    }
    sidecar::services::settings::update_settings(
        db,
        serde_json::json!({ "advanced": { "sidecarPort": actual_port } }),
    )
    .map_err(|error| format!("Failed to persist fallback port {actual_port}: {error}"))?;
    Ok(())
}

fn migrate_legacy_data_dir(
    data_dir: &PathBuf,
    legacy_data_dir: Option<&PathBuf>,
) -> Result<(), String> {
    let Some(legacy) = legacy_data_dir else {
        return Ok(());
    };
    if data_dir == legacy {
        return Ok(());
    }
    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    let marker = data_dir.join(LEGACY_MIGRATION_MARKER);
    if marker.exists() {
        return Ok(());
    }

    let current_settings = data_dir.join("settings.json");
    let legacy_settings = legacy.join("settings.json");
    if !current_settings.exists() && legacy_settings.exists() {
        if let Err(error) = fs::copy(&legacy_settings, &current_settings) {
            let _ = fs::remove_file(&current_settings);
            return Err(error.to_string());
        }
    }

    let current_db = data_dir.join("moor.db");
    let legacy_db = legacy.join("moor.db");
    if !current_db.exists() && legacy_db.exists() {
        let mut copied_files = Vec::new();
        for name in &["moor.db", "moor.db-wal", "moor.db-shm"] {
            let source = legacy.join(name);
            if source.exists() {
                let destination = data_dir.join(name);
                copied_files.push(destination.clone());
                if let Err(error) = fs::copy(&source, destination) {
                    for copied_file in copied_files {
                        let _ = fs::remove_file(copied_file);
                    }
                    return Err(error.to_string());
                }
            }
        }
    }
    fs::write(marker, b"1").map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|arg| arg == AUTOSTART_ARG) {
                return;
            }
            show_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .invoke_handler(tauri::generate_handler![
            get_sidecar_info,
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
            if let Err(error) = migrate_legacy_data_dir(&data_dir, legacy_data_dir.as_ref()) {
                tracing::warn!("Legacy data migration will be retried: {error}");
            }

            // Init database
            fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
            let db_path = data_dir.join("moor.db");
            let db = sidecar::db::Database::open(&db_path)
                .map_err(|e| format!("Failed to open database: {e}"))?;
            db.run_migrations()
                .map_err(|e| format!("Failed to run migrations: {e}"))?;

            // Read settings after migration so the runtime and HTTP API share SQLite settings.
            let settings = sidecar::services::settings::init_settings(&db, &data_dir)
                .map_err(|e| format!("Failed to initialize settings: {e}"))?;
            let configured_port = settings.advanced.sidecar_port;
            let minimize_to_tray = settings.general.minimize_to_tray_on_close;
            let hide_dock_icon_on_close = settings.general.hide_dock_icon_on_close;
            let show_window_on_launch = settings.general.show_window_on_launch;
            let should_show_window =
                should_show_main_window_on_launch(minimize_to_tray, show_window_on_launch);
            let auto_start = settings.general.auto_start_on_login;

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
            let port_fallback_from = (port != configured_port).then_some(configured_port);
            persist_fallback_port(&db, configured_port, port)?;

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
            let app_state = Arc::new(sidecar::http::AppState::new(
                db_arc.clone(),
                api_token.clone(),
                env!("CARGO_PKG_VERSION").to_string(),
                port,
                event_bus.clone(),
                server_manager.clone(),
            ));
            tauri::async_runtime::spawn(
                sidecar::mcp::transport::mcp_session::forward_tool_list_changes(
                    event_bus.subscribe(),
                    app_state.mcp_sessions.clone(),
                ),
            );

            let state = MoorState {
                inner: Arc::new(MoorInner {
                    port,
                    api_token,
                    db: db_arc.clone(),
                    port_fallback_from,
                    minimize_to_tray: AtomicBool::new(minimize_to_tray),
                    hide_dock_icon_on_close: AtomicBool::new(hide_dock_icon_on_close),
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
            let start_auto_start_servers = should_start_auto_start_servers_on_launch(&settings);
            tauri::async_runtime::spawn(async move {
                sm.load_from_db().await;
                if start_auto_start_servers {
                    sm.start_auto_start_servers().await;
                }
            });

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = apply_autostart_setting(&app_handle, auto_start) {
                    tracing::warn!("Failed to apply login autostart setting: {error}");
                }
            });

            // Tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit Moor", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = {
                let builder = TrayIconBuilder::new()
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .tooltip("Moor - MCP Manager")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            show_main_window(app);
                        }
                        _ => {}
                    });

                #[cfg(target_os = "macos")]
                {
                    builder
                        .icon(tauri::include_image!("./icons/tray-template.png"))
                        .icon_as_template(true)
                        .build(app)?
                }

                #[cfg(not(target_os = "macos"))]
                {
                    builder
                        .icon(tauri::include_image!("./icons/32x32.png"))
                        .build(app)?
                }
            };

            if should_show_window {
                show_main_window(app.handle());
            } else if minimize_to_tray && hide_dock_icon_on_close {
                #[cfg(target_os = "macos")]
                let _ = app.handle().set_dock_visibility(false);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::Exit | RunEvent::ExitRequested { .. } => {
                // Server will be dropped automatically when the process exits
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                show_main_window(app_handle);
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
                    if state.get_hide_dock_icon_on_close() {
                        #[cfg(target_os = "macos")]
                        let _ = app_handle.set_dock_visibility(false);
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
                db: Arc::new(
                    sidecar::db::Database::open(std::path::Path::new(":memory:"))
                        .expect("failed to open temp db"),
                ),
                port_fallback_from: None,
                minimize_to_tray: AtomicBool::new(true),
                hide_dock_icon_on_close: AtomicBool::new(false),
            }),
        };
        state.set_minimize_to_tray(false);
        assert!(!state.get_minimize_to_tray());
    }

    #[test]
    fn sync_runtime_settings_only_updates_window_runtime_state_from_database() {
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
        let db = sidecar::db::Database::open(&data_dir.join("moor.db"))
            .expect("failed to open settings db");
        db.run_migrations().expect("failed to migrate settings db");
        sidecar::services::settings::init_settings(&db, &data_dir)
            .expect("settings should initialize");
        sidecar::services::settings::update_settings(
            &db,
            serde_json::json!({ "general": { "minimizeToTrayOnClose": true } }),
        )
        .expect("settings update should succeed");

        let state = MoorState {
            inner: Arc::new(MoorInner {
                port: 9223,
                api_token: "token".to_string(),
                db: Arc::new(db),
                port_fallback_from: None,
                minimize_to_tray: AtomicBool::new(true),
                hide_dock_icon_on_close: AtomicBool::new(false),
            }),
        };

        sync_runtime_settings_from_db(&state, state.inner.db.as_ref())
            .expect("runtime settings sync failed");
        assert!(state.get_minimize_to_tray());
        assert!(
            !sidecar::services::settings::read_settings_file(&data_dir)
                .general
                .minimize_to_tray_on_close
        );
        drop(state);
        fs::remove_dir_all(data_dir).expect("failed to remove temp settings dir");
    }

    #[test]
    fn server_auto_start_respects_global_launch_setting() {
        let mut settings = sidecar::services::settings::default_settings();

        settings.general.auto_start_servers_on_launch = false;
        assert!(!should_start_auto_start_servers_on_launch(&settings));

        settings.general.auto_start_servers_on_launch = true;
        assert!(should_start_auto_start_servers_on_launch(&settings));
    }

    #[test]
    fn finds_available_port() {
        let port = find_available_port("127.0.0.1", 19223, 19233).unwrap();
        assert!((19223..=19233).contains(&port));
    }

    #[test]
    fn persists_selected_fallback_port_for_future_launches() {
        let data_dir = temp_data_dir("fallback-port");
        fs::create_dir_all(&data_dir).expect("failed to create temp settings dir");
        let db = sidecar::db::Database::open(&data_dir.join("moor.db"))
            .expect("failed to open settings db");
        db.run_migrations().expect("failed to migrate settings db");
        sidecar::services::settings::init_settings(&db, &data_dir)
            .expect("settings should initialize");

        persist_fallback_port(&db, 9223, 9224).expect("fallback should persist");
        assert_eq!(
            sidecar::services::settings::get_settings(&db)
                .expect("settings should load")
                .advanced
                .sidecar_port,
            9224
        );
        persist_fallback_port(&db, 9224, 9224).expect("matching port is a no-op");
        drop(db);
        fs::remove_dir_all(data_dir).expect("failed to remove temp settings dir");
    }

    #[test]
    fn legacy_data_migration_uses_completion_marker_after_success() {
        let root = temp_data_dir("legacy-migration");
        let data_dir = root.join("current");
        let legacy_dir = root.join("legacy");
        fs::create_dir_all(&legacy_dir).expect("create legacy data dir");
        fs::write(legacy_dir.join("settings.json"), b"legacy-settings")
            .expect("write legacy settings");
        fs::write(legacy_dir.join("moor.db"), b"legacy-database").expect("write legacy database");

        migrate_legacy_data_dir(&data_dir, Some(&legacy_dir)).expect("migrate legacy data");
        assert_eq!(
            fs::read(data_dir.join("settings.json")).expect("read migrated settings"),
            b"legacy-settings"
        );
        assert_eq!(
            fs::read(data_dir.join("moor.db")).expect("read migrated database"),
            b"legacy-database"
        );
        assert!(data_dir.join(LEGACY_MIGRATION_MARKER).exists());

        fs::write(data_dir.join("settings.json"), b"current-settings")
            .expect("update current settings");
        fs::write(legacy_dir.join("settings.json"), b"changed-legacy-settings")
            .expect("update legacy settings");
        migrate_legacy_data_dir(&data_dir, Some(&legacy_dir))
            .expect("completed migration should be a no-op");
        assert_eq!(
            fs::read(data_dir.join("settings.json")).expect("read current settings"),
            b"current-settings"
        );

        fs::remove_dir_all(root).expect("remove migration test data");
    }
}
