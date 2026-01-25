use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn get_env_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.join(".env"))
}

fn load_env_file(path: &PathBuf) -> HashMap<String, String> {
    let mut env_vars = HashMap::new();
    if let Ok(content) = fs::read_to_string(path) {
        for line in content.lines() {
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim().trim_matches('"').trim_matches('\'');
                if !key.is_empty() && !key.starts_with('#') {
                    env_vars.insert(key.to_string(), value.to_string());
                }
            }
        }
    }
    env_vars
}

fn save_env_file(path: &PathBuf, env_vars: &HashMap<String, String>) -> Result<(), String> {
    let content: String = env_vars
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("\n");

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Get an environment variable from .env file
#[tauri::command]
pub fn get_env_var(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let env_path = get_env_file_path(&app)?;
    let env_vars = load_env_file(&env_path);
    Ok(env_vars.get(&key).cloned())
}

/// Set an environment variable in .env file
#[tauri::command]
pub fn set_env_var(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let env_path = get_env_file_path(&app)?;
    let mut env_vars = load_env_file(&env_path);
    env_vars.insert(key, value);
    save_env_file(&env_path, &env_vars)
}

/// Get a setting from localStorage-like storage
#[tauri::command]
pub fn get_setting(app: AppHandle, key: String) -> Result<Option<serde_json::Value>, String> {
    let settings_path = get_settings_path(&app)?;
    let settings = load_settings(&settings_path);
    Ok(settings.get(&key).cloned())
}

/// Set a setting in localStorage-like storage
#[tauri::command]
pub fn set_setting(app: AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
    let settings_path = get_settings_path(&app)?;
    let mut settings = load_settings(&settings_path);
    settings.insert(key, value);
    save_settings(&settings_path, &settings)
}

/// Get all settings
#[tauri::command]
pub fn get_all_settings(app: AppHandle) -> Result<HashMap<String, serde_json::Value>, String> {
    let settings_path = get_settings_path(&app)?;
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
