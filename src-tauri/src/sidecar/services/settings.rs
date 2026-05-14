use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::Path};

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub auto_start_on_login: bool,
    pub auto_start_servers_on_launch: bool,
    pub minimize_to_tray_on_close: bool,
    pub show_window_on_launch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSettings {
    pub log_retention_days: u16,
    pub enable_audit_logging: bool,
    pub sidecar_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub general: GeneralSettings,
    pub appearance: AppearanceSettings,
    pub advanced: AdvancedSettings,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PartialGeneralSettings {
    auto_start_on_login: Option<bool>,
    auto_start_servers_on_launch: Option<bool>,
    minimize_to_tray_on_close: Option<bool>,
    show_window_on_launch: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PartialAppearanceSettings {
    theme: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PartialAdvancedSettings {
    log_retention_days: Option<u16>,
    enable_audit_logging: Option<bool>,
    sidecar_port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PartialSettings {
    version: Option<u32>,
    general: Option<PartialGeneralSettings>,
    appearance: Option<PartialAppearanceSettings>,
    advanced: Option<PartialAdvancedSettings>,
}

pub fn default_settings() -> Settings {
    Settings {
        version: 1,
        general: GeneralSettings {
            auto_start_on_login: false,
            auto_start_servers_on_launch: false,
            minimize_to_tray_on_close: true,
            show_window_on_launch: true,
        },
        appearance: AppearanceSettings {
            theme: "system".to_string(),
        },
        advanced: AdvancedSettings {
            log_retention_days: 30,
            enable_audit_logging: true,
            sidecar_port: 9223,
        },
    }
}

pub fn settings_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join(SETTINGS_FILE)
}

pub fn read_settings_file(data_dir: &Path) -> Settings {
    let path = settings_path(data_dir);
    let Ok(content) = fs::read_to_string(path) else {
        return default_settings();
    };
    merge_settings_value(
        default_settings(),
        serde_json::from_str(&content).unwrap_or(Value::Null),
    )
    .unwrap_or_else(|_| default_settings())
}

pub fn write_settings_file(data_dir: &Path, settings: &Settings) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(settings_path(data_dir), format!("{content}\n")).map_err(|e| e.to_string())
}

pub fn update_settings_file(data_dir: &Path, patch: Value) -> Result<Settings, String> {
    let current = read_settings_file(data_dir);
    let updated = merge_settings_value(current, patch)?;
    validate_settings(&updated)?;
    write_settings_file(data_dir, &updated)?;
    Ok(updated)
}

pub fn reset_settings_file(data_dir: &Path) -> Result<Settings, String> {
    let settings = default_settings();
    write_settings_file(data_dir, &settings)?;
    Ok(settings)
}

fn merge_settings_value(mut base: Settings, value: Value) -> Result<Settings, String> {
    if value.is_null() {
        return Ok(base);
    }
    let partial: PartialSettings =
        serde_json::from_value(value).map_err(|e| format!("Invalid settings payload: {e}"))?;
    if let Some(version) = partial.version {
        base.version = version;
    }
    if let Some(general) = partial.general {
        if let Some(value) = general.auto_start_on_login {
            base.general.auto_start_on_login = value;
        }
        if let Some(value) = general.auto_start_servers_on_launch {
            base.general.auto_start_servers_on_launch = value;
        }
        if let Some(value) = general.minimize_to_tray_on_close {
            base.general.minimize_to_tray_on_close = value;
        }
        if let Some(value) = general.show_window_on_launch {
            base.general.show_window_on_launch = value;
        }
    }
    if let Some(appearance) = partial.appearance {
        if let Some(theme) = appearance.theme {
            base.appearance.theme = theme;
        }
    }
    if let Some(advanced) = partial.advanced {
        if let Some(value) = advanced.log_retention_days {
            base.advanced.log_retention_days = value;
        }
        if let Some(value) = advanced.enable_audit_logging {
            base.advanced.enable_audit_logging = value;
        }
        if let Some(value) = advanced.sidecar_port {
            base.advanced.sidecar_port = value;
        }
    }
    validate_settings(&base)?;
    Ok(base)
}

fn validate_settings(settings: &Settings) -> Result<(), String> {
    if settings.version == 0 {
        return Err("version must be at least 1".to_string());
    }
    if !matches!(
        settings.appearance.theme.as_str(),
        "light" | "dark" | "system"
    ) {
        return Err("appearance.theme must be light, dark, or system".to_string());
    }
    if settings.advanced.log_retention_days > 365 {
        return Err("advanced.logRetentionDays must be between 0 and 365".to_string());
    }
    if settings.advanced.sidecar_port < 1024 {
        return Err("advanced.sidecarPort must be between 1024 and 65535".to_string());
    }
    Ok(())
}

pub fn audit_logging_enabled(data_dir: &Path) -> bool {
    read_settings_file(data_dir).advanced.enable_audit_logging
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    fn temp_data_dir(test_name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moor-settings-{test_name}-{timestamp}"))
    }

    #[test]
    fn fresh_store_returns_defaults() {
        let data_dir = temp_data_dir("fresh");
        let settings = read_settings_file(&data_dir);
        assert_eq!(settings, default_settings());
    }

    #[test]
    fn patch_deep_merges_and_writes_settings_json() {
        let data_dir = temp_data_dir("patch");
        let updated = update_settings_file(
            &data_dir,
            serde_json::json!({
                "general": { "minimizeToTrayOnClose": false },
                "advanced": { "sidecarPort": 9333 }
            }),
        )
        .expect("settings update should succeed");

        assert!(!updated.general.minimize_to_tray_on_close);
        assert!(updated.general.show_window_on_launch);
        assert_eq!(updated.advanced.sidecar_port, 9333);
        assert_eq!(read_settings_file(&data_dir), updated);
        let _ = fs::remove_dir_all(data_dir);
    }

    #[test]
    fn rejects_invalid_port_updates() {
        let data_dir = temp_data_dir("invalid-port");
        let err = update_settings_file(
            &data_dir,
            serde_json::json!({ "advanced": { "sidecarPort": 80 } }),
        )
        .expect_err("invalid port should fail");
        assert!(err.contains("advanced.sidecarPort"));
    }
}
