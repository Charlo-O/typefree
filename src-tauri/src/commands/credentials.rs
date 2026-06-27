use serde::Serialize;
use std::{collections::HashMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

use super::command_error::{CommandError, CommandResult};

#[cfg(target_os = "windows")]
use std::io::ErrorKind;

#[cfg(target_os = "linux")]
use std::io::Write;

#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};

const ALLOWED_CREDENTIAL_KEYS: &[&str] = &[
    "ASSEMBLYAI_API_KEY",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
    "ZAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "CUSTOM_REASONING_API_KEY",
    "CUSTOM_TRANSCRIPTION_API_KEY",
    "VOLCENGINE_APP_ID",
    "VOLCENGINE_ACCESS_TOKEN",
];

fn credential_error(message: impl Into<String>) -> CommandError {
    CommandError::from_message(message.into()).with_source("credential-store")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub key: String,
    pub present: bool,
}

pub fn validate_credential_key(key: &str) -> CommandResult<()> {
    if ALLOWED_CREDENTIAL_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(
            CommandError::configuration(format!("Unsupported credential key: {key}"))
                .with_source("credential-store"),
        )
    }
}

pub fn get_credential_value(app: &AppHandle, key: &str) -> CommandResult<Option<String>> {
    validate_credential_key(key)?;

    if let Some(value) = platform_get_credential(app, key).map_err(credential_error)? {
        return Ok(Some(value));
    }

    let Some(value) = read_legacy_env_key(app, key).map_err(credential_error)? else {
        return Ok(None);
    };

    platform_set_credential(app, key, &value).map_err(credential_error)?;
    remove_legacy_env_key(app, key).map_err(credential_error)?;
    Ok(Some(value))
}

pub fn set_credential_value(app: &AppHandle, key: &str, value: &str) -> CommandResult<()> {
    validate_credential_key(key)?;
    if value.trim().is_empty() {
        return delete_credential_value(app, key);
    }

    platform_set_credential(app, key, value).map_err(credential_error)?;
    remove_legacy_env_key(app, key).map_err(credential_error)
}

pub fn delete_credential_value(app: &AppHandle, key: &str) -> CommandResult<()> {
    validate_credential_key(key)?;
    platform_delete_credential(app, key).map_err(credential_error)?;
    remove_legacy_env_key(app, key).map_err(credential_error)
}

pub fn get_credential_status_value(app: &AppHandle, key: &str) -> CommandResult<CredentialStatus> {
    validate_credential_key(key)?;
    let present = platform_has_credential(app, key).map_err(credential_error)?;
    Ok(CredentialStatus {
        key: key.to_string(),
        present,
    })
}

#[tauri::command]
pub fn get_credential(app: AppHandle, key: String) -> CommandResult<Option<String>> {
    get_credential_value(&app, &key)
}

#[tauri::command]
pub fn get_credential_status(app: AppHandle, key: String) -> CommandResult<CredentialStatus> {
    get_credential_status_value(&app, &key)
}

#[tauri::command]
pub fn set_credential(app: AppHandle, key: String, value: String) -> CommandResult<()> {
    set_credential_value(&app, &key, &value)
}

#[tauri::command]
pub fn delete_credential(app: AppHandle, key: String) -> CommandResult<()> {
    delete_credential_value(&app, &key)
}

fn legacy_env_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.join(".env"))
}

fn load_legacy_env_file(path: &PathBuf) -> HashMap<String, String> {
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

fn save_legacy_env_file(path: &PathBuf, env_vars: &HashMap<String, String>) -> Result<(), String> {
    let content = env_vars
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("\n");

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

fn read_legacy_env_key(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let env_path = legacy_env_file_path(app)?;
    let env_vars = load_legacy_env_file(&env_path);
    Ok(env_vars.get(key).cloned())
}

fn remove_legacy_env_key(app: &AppHandle, key: &str) -> Result<(), String> {
    let env_path = legacy_env_file_path(app)?;
    if !env_path.exists() {
        return Ok(());
    }

    let mut env_vars = load_legacy_env_file(&env_path);
    if env_vars.remove(key).is_some() {
        save_legacy_env_file(&env_path, &env_vars)?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn credential_file_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir
        .join("credentials")
        .join(format!("{key}.dpapi")))
}

#[cfg(target_os = "windows")]
fn platform_get_credential(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let path = credential_file_path(app, key)?;
    if !path.exists() {
        return Ok(None);
    }

    let encrypted = fs::read(&path).map_err(|e| format!("Failed to read credential: {e}"))?;
    let plaintext = dpapi_unprotect(&encrypted)?;
    let value =
        String::from_utf8(plaintext).map_err(|e| format!("Credential is not valid UTF-8: {e}"))?;
    Ok(Some(value))
}

#[cfg(target_os = "windows")]
fn platform_has_credential(app: &AppHandle, key: &str) -> Result<bool, String> {
    let path = credential_file_path(app, key)?;
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.is_file() && metadata.len() > 0),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(false),
        Err(err) => Err(format!("Failed to inspect credential: {err}")),
    }
}

#[cfg(target_os = "windows")]
fn platform_set_credential(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let path = credential_file_path(app, key)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create credential dir: {e}"))?;
    }

    let encrypted = dpapi_protect(value.as_bytes())?;
    fs::write(path, encrypted).map_err(|e| format!("Failed to write credential: {e}"))
}

#[cfg(target_os = "windows")]
fn platform_delete_credential(app: &AppHandle, key: &str) -> Result<(), String> {
    let path = credential_file_path(app, key)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Failed to delete credential: {err}")),
    }
}

#[cfg(target_os = "windows")]
fn dpapi_protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::slice;
    use windows::core::w;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if data.len() > u32::MAX as usize {
        return Err("Credential is too large".to_string());
    }

    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &input,
            w!("TypeFree credential"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| format!("DPAPI protect failed: {e}"))?;

        let encrypted = slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(encrypted)
    }
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::slice;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if data.len() > u32::MAX as usize {
        return Err("Credential is too large".to_string());
    }

    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| format!("DPAPI unprotect failed: {e}"))?;

        let plaintext = slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(plaintext)
    }
}

#[cfg(target_os = "macos")]
fn platform_has_credential(_app: &AppHandle, key: &str) -> Result<bool, String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-a", key, "-s", "TypeFree"])
        .output()
        .map_err(|e| format!("Failed to call macOS Keychain: {e}"))?;

    if output.status.success() {
        return Ok(true);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("could not be found")
        || stderr.contains("The specified item could not be found")
    {
        return Ok(false);
    }

    Err(format!(
        "Failed to inspect macOS Keychain credential: {stderr}"
    ))
}

#[cfg(target_os = "macos")]
fn platform_get_credential(_app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-a", key, "-s", "TypeFree", "-w"])
        .output()
        .map_err(|e| format!("Failed to call macOS Keychain: {e}"))?;

    if output.status.success() {
        let value = String::from_utf8(output.stdout)
            .map_err(|e| format!("Credential is not UTF-8: {e}"))?;
        return Ok(Some(
            value
                .trim_end_matches(|ch| ch == '\r' || ch == '\n')
                .to_string(),
        ));
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("could not be found")
        || stderr.contains("The specified item could not be found")
    {
        return Ok(None);
    }

    Err(format!(
        "Failed to read macOS Keychain credential: {stderr}"
    ))
}

#[cfg(target_os = "macos")]
fn platform_set_credential(_app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let status = Command::new("security")
        .args([
            "add-generic-password",
            "-U",
            "-a",
            key,
            "-s",
            "TypeFree",
            "-w",
            value,
        ])
        .status()
        .map_err(|e| format!("Failed to call macOS Keychain: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to write macOS Keychain credential: {status}"
        ))
    }
}

#[cfg(target_os = "macos")]
fn platform_delete_credential(_app: &AppHandle, key: &str) -> Result<(), String> {
    let output = Command::new("security")
        .args(["delete-generic-password", "-a", key, "-s", "TypeFree"])
        .output()
        .map_err(|e| format!("Failed to call macOS Keychain: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("could not be found")
        || stderr.contains("The specified item could not be found")
    {
        return Ok(());
    }

    Err(format!(
        "Failed to delete macOS Keychain credential: {stderr}"
    ))
}

#[cfg(target_os = "linux")]
fn platform_has_credential(_app: &AppHandle, key: &str) -> Result<bool, String> {
    let output = Command::new("secret-tool")
        .args(["search", "application", "TypeFree", "key", key])
        .output()
        .map_err(|e| format!("Failed to call Linux Secret Service: {e}"))?;

    if output.status.success() {
        return Ok(!output.stdout.is_empty());
    }

    if output.stdout.is_empty() && output.stderr.is_empty() {
        return Ok(false);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "Failed to inspect Linux Secret Service credential: {stderr}"
    ))
}

#[cfg(target_os = "linux")]
fn platform_get_credential(_app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let output = Command::new("secret-tool")
        .args(["lookup", "application", "TypeFree", "key", key])
        .output()
        .map_err(|e| format!("Failed to call Linux Secret Service: {e}"))?;

    if output.status.success() {
        let value = String::from_utf8(output.stdout)
            .map_err(|e| format!("Credential is not UTF-8: {e}"))?;
        return Ok(Some(
            value
                .trim_end_matches(|ch| ch == '\r' || ch == '\n')
                .to_string(),
        ));
    }

    if output.stdout.is_empty() && output.stderr.is_empty() {
        return Ok(None);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "Failed to read Linux Secret Service credential: {stderr}"
    ))
}

#[cfg(target_os = "linux")]
fn platform_set_credential(_app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let label = format!("TypeFree {key}");
    let mut child = Command::new("secret-tool")
        .args([
            "store",
            "--label",
            label.as_str(),
            "application",
            "TypeFree",
            "key",
            key,
        ])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to call Linux Secret Service: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(value.as_bytes())
            .map_err(|e| format!("Failed to send credential to Secret Service: {e}"))?;
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for Secret Service: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to write Linux Secret Service credential: {status}"
        ))
    }
}

#[cfg(target_os = "linux")]
fn platform_delete_credential(_app: &AppHandle, key: &str) -> Result<(), String> {
    let output = Command::new("secret-tool")
        .args(["clear", "application", "TypeFree", "key", key])
        .output()
        .map_err(|e| format!("Failed to call Linux Secret Service: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    if output.stdout.is_empty() && output.stderr.is_empty() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "Failed to delete Linux Secret Service credential: {stderr}"
    ))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn platform_has_credential(_app: &AppHandle, _key: &str) -> Result<bool, String> {
    Err("Credential store is not supported on this platform".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn platform_get_credential(_app: &AppHandle, _key: &str) -> Result<Option<String>, String> {
    Err("Credential store is not supported on this platform".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn platform_set_credential(_app: &AppHandle, _key: &str, _value: &str) -> Result<(), String> {
    Err("Credential store is not supported on this platform".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn platform_delete_credential(_app: &AppHandle, _key: &str) -> Result<(), String> {
    Err("Credential store is not supported on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use crate::commands::command_error::CommandErrorKind;

    use super::*;

    #[test]
    fn validates_only_user_editable_provider_credentials() {
        assert!(validate_credential_key("OPENAI_API_KEY").is_ok());
        assert!(validate_credential_key("VOLCENGINE_ACCESS_TOKEN").is_ok());

        let error = validate_credential_key("VOLCENGINE_RESOURCE_ID")
            .expect_err("Volcengine protocol resource id is internal metadata");
        assert_eq!(error.kind, CommandErrorKind::Configuration);
        assert!(error.message.contains("Unsupported credential key"));
    }

    #[test]
    fn credential_status_shape_stays_secretless() {
        let status = CredentialStatus {
            key: "OPENAI_API_KEY".to_string(),
            present: true,
        };

        assert_eq!(status.key, "OPENAI_API_KEY");
        assert!(status.present);
    }
}
