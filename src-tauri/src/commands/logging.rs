use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use tauri::AppHandle;
use tauri::Manager;

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
