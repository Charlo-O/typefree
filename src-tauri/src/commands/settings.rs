use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use super::command_error::{CommandError, CommandResult};
use super::credentials;

fn settings_error(message: impl Into<String>) -> CommandError {
    CommandError::from_message(message.into()).with_source("settings")
}

const SENSITIVE_SETTING_CREDENTIAL_KEYS: &[(&str, &str)] = &[
    ("openaiApiKey", "OPENAI_API_KEY"),
    ("assemblyaiApiKey", "ASSEMBLYAI_API_KEY"),
    ("anthropicApiKey", "ANTHROPIC_API_KEY"),
    ("geminiApiKey", "GEMINI_API_KEY"),
    ("groqApiKey", "GROQ_API_KEY"),
    ("deepseekApiKey", "DEEPSEEK_API_KEY"),
    ("zaiApiKey", "ZAI_API_KEY"),
    ("volcengineAppId", "VOLCENGINE_APP_ID"),
    ("volcengineAccessToken", "VOLCENGINE_ACCESS_TOKEN"),
    ("customReasoningApiKey", "CUSTOM_REASONING_API_KEY"),
    ("customTranscriptionApiKey", "CUSTOM_TRANSCRIPTION_API_KEY"),
    ("OPENAI_API_KEY", "OPENAI_API_KEY"),
    ("ASSEMBLYAI_API_KEY", "ASSEMBLYAI_API_KEY"),
    ("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
    ("GEMINI_API_KEY", "GEMINI_API_KEY"),
    ("GROQ_API_KEY", "GROQ_API_KEY"),
    ("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"),
    ("ZAI_API_KEY", "ZAI_API_KEY"),
    ("VOLCENGINE_APP_ID", "VOLCENGINE_APP_ID"),
    ("VOLCENGINE_ACCESS_TOKEN", "VOLCENGINE_ACCESS_TOKEN"),
    ("CUSTOM_REASONING_API_KEY", "CUSTOM_REASONING_API_KEY"),
    (
        "CUSTOM_TRANSCRIPTION_API_KEY",
        "CUSTOM_TRANSCRIPTION_API_KEY",
    ),
];

fn credential_key_for_sensitive_setting(key: &str) -> Option<&'static str> {
    SENSITIVE_SETTING_CREDENTIAL_KEYS
        .iter()
        .find_map(|(setting_key, credential_key)| (*setting_key == key).then_some(*credential_key))
}

fn reject_sensitive_setting_key(key: &str) -> Result<(), String> {
    if let Some(credential_key) = credential_key_for_sensitive_setting(key) {
        Err(format!(
            "Sensitive setting {key} must be stored with credential store key {credential_key}"
        ))
    } else {
        Ok(())
    }
}

/// Compatibility command for legacy callers. Credentials are read from the OS
/// credential store first, then migrated from the old plaintext .env file.
#[tauri::command]
pub fn get_env_var(app: AppHandle, key: String) -> CommandResult<Option<String>> {
    credentials::get_credential_value(&app, &key)
}

/// Compatibility command for legacy callers. New values are written to the OS
/// credential store and removed from the old plaintext .env file.
#[tauri::command]
pub fn set_env_var(app: AppHandle, key: String, value: String) -> CommandResult<()> {
    credentials::set_credential_value(&app, &key, &value)
}

/// Get a setting from localStorage-like storage
#[tauri::command]
pub fn get_setting(app: AppHandle, key: String) -> CommandResult<Option<serde_json::Value>> {
    get_setting_value(app, key).map_err(settings_error)
}

pub fn get_setting_value(app: AppHandle, key: String) -> Result<Option<serde_json::Value>, String> {
    if let Some(credential_key) = credential_key_for_sensitive_setting(&key) {
        migrate_sensitive_setting_value(&app, credential_key, &key)?;
        return Ok(None);
    }

    let settings_path = get_settings_path(&app)?;
    let settings = load_settings(&settings_path);
    Ok(settings.get(&key).cloned())
}

/// Set a setting in localStorage-like storage
#[tauri::command]
pub fn set_setting(app: AppHandle, key: String, value: serde_json::Value) -> CommandResult<()> {
    set_setting_value(app, key, value).map_err(settings_error)
}

pub fn set_setting_value(
    app: AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    reject_sensitive_setting_key(&key)?;

    let settings_path = get_settings_path(&app)?;
    let mut settings = load_settings(&settings_path);
    settings.insert(key, value);
    save_settings(&settings_path, &settings)
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn remove_setting_value(app: AppHandle, key: String) -> Result<(), String> {
    let settings_path = get_settings_path(&app)?;
    if !settings_path.exists() {
        return Ok(());
    }

    let mut settings = load_settings(&settings_path);
    if settings.remove(&key).is_some() {
        save_settings(&settings_path, &settings)?;
    }

    Ok(())
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn get_secret_value(
    app: &AppHandle,
    credential_key: &str,
    legacy_setting_key: &str,
) -> CommandResult<Option<String>> {
    if let Some(value) = credentials::get_credential_value(app, credential_key)? {
        return Ok(Some(value));
    }

    migrate_sensitive_setting_value(app, credential_key, legacy_setting_key).map_err(settings_error)
}

/// Get all settings
#[tauri::command]
pub fn get_all_settings(app: AppHandle) -> CommandResult<HashMap<String, serde_json::Value>> {
    migrate_all_sensitive_settings(&app).map_err(settings_error)?;
    let settings_path = get_settings_path(&app).map_err(settings_error)?;
    Ok(load_settings(&settings_path))
}

fn get_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("settings.json"))
}

fn load_settings(path: &PathBuf) -> HashMap<String, serde_json::Value> {
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(settings) = serde_json::from_str(&content) {
            return settings;
        }
    }
    HashMap::new()
}

fn save_settings(
    path: &PathBuf,
    settings: &HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn trimmed_string_setting(value: &serde_json::Value) -> Option<String> {
    value.as_str().map(str::trim).and_then(|value| {
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn migrate_sensitive_setting_value(
    app: &AppHandle,
    credential_key: &str,
    legacy_setting_key: &str,
) -> Result<Option<String>, String> {
    let settings_path = get_settings_path(app)?;
    if !settings_path.exists() {
        return Ok(None);
    }

    let mut settings = load_settings(&settings_path);
    let legacy_value = settings
        .get(legacy_setting_key)
        .and_then(trimmed_string_setting);

    if let Some(value) = legacy_value.as_deref() {
        credentials::set_credential_value(app, credential_key, value).map_err(|e| e.to_string())?;
    }

    if settings.remove(legacy_setting_key).is_some() {
        save_settings(&settings_path, &settings)?;
    }

    Ok(legacy_value)
}

fn migrate_all_sensitive_settings(app: &AppHandle) -> Result<(), String> {
    let settings_path = get_settings_path(app)?;
    if !settings_path.exists() {
        return Ok(());
    }

    let mut settings = load_settings(&settings_path);
    let mut migrated_values = Vec::new();
    for (legacy_setting_key, credential_key) in SENSITIVE_SETTING_CREDENTIAL_KEYS {
        if let Some(value) = settings
            .get(*legacy_setting_key)
            .and_then(trimmed_string_setting)
        {
            migrated_values.push((*credential_key, value));
        }
    }

    for (credential_key, value) in migrated_values {
        credentials::set_credential_value(app, credential_key, &value)
            .map_err(|e| e.to_string())?;
    }

    let mut changed = false;
    for (legacy_setting_key, _) in SENSITIVE_SETTING_CREDENTIAL_KEYS {
        changed = settings.remove(*legacy_setting_key).is_some() || changed;
    }

    if changed {
        save_settings(&settings_path, &settings)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_sensitive_setting_mirrors_to_credential_keys() {
        assert_eq!(
            credential_key_for_sensitive_setting("openaiApiKey"),
            Some("OPENAI_API_KEY")
        );
        assert_eq!(
            credential_key_for_sensitive_setting("VOLCENGINE_ACCESS_TOKEN"),
            Some("VOLCENGINE_ACCESS_TOKEN")
        );
        assert_eq!(
            credential_key_for_sensitive_setting("preferredLanguage"),
            None
        );
    }

    #[test]
    fn rejects_sensitive_settings_before_json_persistence() {
        let error =
            reject_sensitive_setting_key("openaiApiKey").expect_err("API keys must not persist");
        assert!(error.contains("credential store key OPENAI_API_KEY"));
        assert!(reject_sensitive_setting_key("preferredLanguage").is_ok());
    }

    #[test]
    fn trims_string_settings_before_migrating_legacy_secrets() {
        assert_eq!(
            trimmed_string_setting(&serde_json::json!("  secret  ")),
            Some("secret".to_string())
        );
        assert_eq!(trimmed_string_setting(&serde_json::json!("   ")), None);
        assert_eq!(trimmed_string_setting(&serde_json::json!(true)), None);
    }
}
