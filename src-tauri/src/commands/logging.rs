use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use super::command_error::{CommandError, CommandResult};

fn logging_error(message: impl Into<String>) -> CommandError {
    CommandError::from_message(message.into()).with_source("logging")
}

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

fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase().replace('-', "_");
    let compact = lower.replace('_', "");
    matches!(
        compact.as_str(),
        "apikey"
            | "accesstoken"
            | "authtoken"
            | "token"
            | "secret"
            | "password"
            | "credential"
            | "authorization"
            | "keypreview"
            | "tokenpreview"
            | "secretpreview"
            | "credentialpreview"
    ) || compact.ends_with("apikey")
        || compact.ends_with("accesstoken")
        || compact.ends_with("authtoken")
        || compact.ends_with("secret")
        || compact.ends_with("password")
        || compact.ends_with("credential")
        || compact.ends_with("authorization")
        || compact.ends_with("keypreview")
        || compact.ends_with("tokenpreview")
        || compact.ends_with("secretpreview")
        || compact.ends_with("credentialpreview")
}

fn is_text_payload_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase().replace('-', "_");
    let compact = lower.replace('_', "");
    matches!(
        compact.as_str(),
        "text"
            | "rawtext"
            | "processedtext"
            | "transcript"
            | "transcription"
            | "clipboardtext"
            | "selectedtext"
            | "prompt"
            | "systemprompt"
            | "userprompt"
            | "content"
            | "delta"
            | "input"
            | "output"
            | "messages"
            | "requestbody"
            | "response"
            | "responsetext"
            | "fullresponse"
            | "fullresult"
            | "errortext"
            | "textpreview"
            | "resultpreview"
            | "datapreview"
            | "chunkpreview"
    )
}

fn redact_freeform_text(value: &str) -> String {
    let mut redacted = value.to_string();
    for marker in [
        "Bearer ", "sk-", "xoxb-", "xoxa-", "xoxp-", "xoxr-", "xoxs-",
    ] {
        if let Some(index) = redacted.find(marker) {
            redacted.truncate(index);
            redacted.push_str("[REDACTED_SECRET]");
            return redacted;
        }
    }
    redacted
}

fn redact_log_value(key: Option<&str>, value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::String(text) => {
            if key.map(is_sensitive_key).unwrap_or(false) {
                serde_json::Value::String("[REDACTED_SECRET]".to_string())
            } else if key.map(is_text_payload_key).unwrap_or(false) {
                serde_json::Value::String(format!("[REDACTED_TEXT length={}]", text.len()))
            } else {
                serde_json::Value::String(redact_freeform_text(&text))
            }
        }
        serde_json::Value::Array(items) => serde_json::Value::Array(
            items
                .into_iter()
                .map(|item| redact_log_value(key, item))
                .collect(),
        ),
        serde_json::Value::Object(entries) => serde_json::Value::Object(
            entries
                .into_iter()
                .map(|(entry_key, entry_value)| {
                    let redacted = redact_log_value(Some(&entry_key), entry_value);
                    (entry_key, redacted)
                })
                .collect(),
        ),
        other => other,
    }
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
pub fn write_renderer_log(app: AppHandle, entry: RendererLogEntry) -> CommandResult<()> {
    write_renderer_log_value(&app, entry).map_err(logging_error)
}

fn write_renderer_log_value(app: &AppHandle, entry: RendererLogEntry) -> Result<(), String> {
    let dir = logs_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file_path = dir.join("renderer.log");

    // Keep lines reasonably small so logs stay greppable.
    let message = truncate_string(redact_freeform_text(&entry.message), 8000);

    let line = PersistedLogLine {
        ts_ms: now_ms(),
        level: entry.level,
        scope: entry.scope,
        message,
        meta: entry.meta.map(|meta| redact_log_value(None, meta)),
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
pub fn get_debug_state(app: AppHandle) -> CommandResult<DebugState> {
    debug_state(&app).map_err(logging_error)
}

#[tauri::command]
pub fn set_debug_logging(app: AppHandle, enabled: bool) -> CommandResult<DebugLoggingResult> {
    set_debug_logging_value(&app, enabled).map_err(logging_error)
}

fn set_debug_logging_value(app: &AppHandle, enabled: bool) -> Result<DebugLoggingResult, String> {
    let level = if enabled { "debug" } else { "info" };
    set_log_level(app, level)?;

    let path = renderer_log_path(app)?;
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
pub fn open_logs_folder(app: AppHandle) -> CommandResult<()> {
    open_logs_folder_value(&app).map_err(logging_error)
}

fn open_logs_folder_value(app: &AppHandle) -> Result<(), String> {
    let dir = logs_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_secret_and_text_payload_fields() {
        let value = serde_json::json!({
            "apiKey": "sk-test-secret",
            "accessToken": "volc-token",
            "authorization": "Bearer abc123",
            "keyPreview": "sk-test-...",
            "rawText": "private dictated sentence",
            "textPreview": "private dict",
            "resultPreview": "cleaned priv",
            "selectedText": "selected private text",
            "systemPrompt": "system prompt with private context",
            "userPrompt": "user prompt with dictated content",
            "requestBody": "{\"messages\":[{\"content\":\"private request body\"}]}",
            "fullResponse": "{\"output\":\"private model output\"}",
            "response": "{\"message\":\"private response\"}",
            "textLength": 25,
            "nested": {
                "prompt": "rewrite this private paragraph",
                "model": "glm-asr-2512"
            }
        });

        let redacted = redact_log_value(None, value);

        assert_eq!(redacted["apiKey"], "[REDACTED_SECRET]");
        assert_eq!(redacted["accessToken"], "[REDACTED_SECRET]");
        assert_eq!(redacted["authorization"], "[REDACTED_SECRET]");
        assert_eq!(redacted["keyPreview"], "[REDACTED_SECRET]");
        assert_eq!(redacted["rawText"], "[REDACTED_TEXT length=25]");
        assert_eq!(redacted["textPreview"], "[REDACTED_TEXT length=12]");
        assert_eq!(redacted["resultPreview"], "[REDACTED_TEXT length=12]");
        assert_eq!(redacted["selectedText"], "[REDACTED_TEXT length=21]");
        assert_eq!(redacted["systemPrompt"], "[REDACTED_TEXT length=34]");
        assert_eq!(redacted["userPrompt"], "[REDACTED_TEXT length=33]");
        assert!(redacted["requestBody"]
            .as_str()
            .unwrap()
            .starts_with("[REDACTED_TEXT length="));
        assert!(redacted["fullResponse"]
            .as_str()
            .unwrap()
            .starts_with("[REDACTED_TEXT length="));
        assert!(redacted["response"]
            .as_str()
            .unwrap()
            .starts_with("[REDACTED_TEXT length="));
        assert_eq!(redacted["nested"]["prompt"], "[REDACTED_TEXT length=30]");
        assert_eq!(redacted["nested"]["model"], "glm-asr-2512");
        assert_eq!(redacted["textLength"], 25);
    }

    #[test]
    fn redacts_bearer_tokens_in_freeform_messages() {
        let message = redact_freeform_text("request failed with Bearer abc.def.ghi");

        assert_eq!(message, "request failed with [REDACTED_SECRET]");
    }
}
