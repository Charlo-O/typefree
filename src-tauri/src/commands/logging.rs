use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Deserialize)]
pub struct RendererLogEntry {
    pub level: String,
    pub message: String,
    pub meta: Option<serde_json::Value>,
    pub scope: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Serialize)]
struct PersistedLogLine {
    ts_ms: u128,
    level: String,
    scope: Option<String>,
    message: String,
    meta: Option<serde_json::Value>,
    source: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DebugState {
    pub enabled: bool,
    #[serde(rename = "logPath")]
    pub log_path: Option<String>,
    #[serde(rename = "logLevel")]
    pub log_level: String,
}

#[derive(Debug, Serialize)]
pub struct DebugLoggingResult {
    pub success: bool,
    pub enabled: bool,
    #[serde(rename = "logPath")]
    pub log_path: Option<String>,
    pub error: Option<String>,
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn truncate_string(value: String, max_len: usize) -> String {
    if value.len() <= max_len {
        return value;
    }
    let mut out = value;
    out.truncate(max_len);
    out
}

fn logs_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("logs"))
}

fn renderer_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(logs_dir(app)?.join("renderer.log"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("settings.json"))
}

fn load_settings(path: &PathBuf) -> serde_json::Map<String, serde_json::Value> {
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(serde_json::Value::Object(settings)) =
            serde_json::from_str::<serde_json::Value>(&content)
        {
            return settings;
        }
    }
    serde_json::Map::new()
}

fn save_settings(
    path: &PathBuf,
    settings: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn read_log_level(app: &AppHandle) -> Result<String, String> {
    let path = settings_path(app)?;
    let settings = load_settings(&path);
    let default_level = if cfg!(debug_assertions) {
        "debug"
    } else {
        "info"
    };
    Ok(settings
        .get("logLevel")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(default_level)
        .to_string())
}

fn set_log_level(app: &AppHandle, level: &str) -> Result<(), String> {
    let path = settings_path(app)?;
    let mut settings = load_settings(&path);
    settings.insert(
        "logLevel".to_string(),
        serde_json::Value::String(level.to_string()),
    );
    save_settings(&path, &settings)
}

fn is_debug_enabled(level: &str) -> bool {
    matches!(level.to_ascii_lowercase().as_str(), "trace" | "debug")
}

fn debug_state(app: &AppHandle) -> Result<DebugState, String> {
    let level = read_log_level(app)?;
    let path = renderer_log_path(app)?;
    Ok(DebugState {
        enabled: is_debug_enabled(&level),
        log_path: Some(path.to_string_lossy().to_string()),
        log_level: level,
    })
}

#[tauri::command]
pub fn write_renderer_log(app: AppHandle, entry: RendererLogEntry) -> Result<(), String> {
    let dir = logs_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file_path = dir.join("renderer.log");

    // Keep lines reasonably small so logs stay greppable.
    let message = truncate_string(entry.message, 8000);

    let line = PersistedLogLine {
        ts_ms: now_ms(),
        level: entry.level,
        scope: entry.scope,
        message,
        meta: entry.meta,
        source: entry.source,
    };

    let json = serde_json::to_string(&line).map_err(|e| e.to_string())?;

    // 1) Persist to file
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", json).map_err(|e| e.to_string())?;

    // 2) Also mirror to stderr so `tauri:dev` logs can be grepped without
    // mixing with the frontend dev server output.
    // Prefix helps make it easy to search.
    eprintln!("RENDERER_LOG {}", json);

    Ok(())
}

#[tauri::command]
pub fn get_debug_state(app: AppHandle) -> Result<DebugState, String> {
    debug_state(&app)
}

#[tauri::command]
pub fn set_debug_logging(app: AppHandle, enabled: bool) -> Result<DebugLoggingResult, String> {
    let level = if enabled { "debug" } else { "info" };
    set_log_level(&app, level)?;

    let path = renderer_log_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if enabled {
        let _ = OpenOptions::new().create(true).append(true).open(&path);
    }

    Ok(DebugLoggingResult {
        success: true,
        enabled,
        log_path: Some(path.to_string_lossy().to_string()),
        error: None,
    })
}

#[tauri::command]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let dir = logs_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}
