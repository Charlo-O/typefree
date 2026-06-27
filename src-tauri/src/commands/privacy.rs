use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::AppHandle;

const BLACKLIST_KEY: &str = "privacyApplicationBlacklist";
const PAUSE_HISTORY_KEY: &str = "privacyPauseHistoryInBlacklistedApps";
const PAUSE_CLIPBOARD_KEY: &str = "privacyPauseClipboardInBlacklistedApps";
const AUTO_DELETE_HISTORY_KEY: &str = "privacyAutoDeleteHistoryEnabled";
const HISTORY_RETENTION_DAYS_KEY: &str = "privacyHistoryRetentionDays";
const ACTIVE_FOREGROUND_KEY: &str = "activeForegroundApplication";
const ACTIVE_FOREGROUND_ID_KEY: &str = "activeForegroundApplicationId";
const DEFAULT_HISTORY_RETENTION_DAYS: i64 = 30;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyForegroundApplication {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub process_id: Option<u32>,
    pub bundle_id: Option<String>,
    pub executable_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyDiagnostics {
    pub detected_foreground: Option<PrivacyForegroundApplication>,
    pub active_foreground: Option<PrivacyForegroundApplication>,
    pub application_blacklist: Vec<String>,
    pub detected_candidates: Vec<String>,
    pub active_candidates: Vec<String>,
    pub detected_application_blacklisted: bool,
    pub active_application_blacklisted: bool,
    pub pause_history_in_blacklisted_apps: bool,
    pub pause_clipboard_in_blacklisted_apps: bool,
    pub auto_delete_history_enabled: bool,
    pub history_retention_days: i64,
    pub effective_history_retention_days: Option<i64>,
    pub would_skip_transcription_history: bool,
    pub would_skip_clipboard_capture: bool,
    pub detection_error: Option<String>,
}

impl From<super::window::ForegroundApplication> for PrivacyForegroundApplication {
    fn from(application: super::window::ForegroundApplication) -> Self {
        Self {
            id: application.id,
            name: application.name,
            platform: application.platform,
            process_id: application.process_id,
            bundle_id: application.bundle_id,
            executable_path: application.executable_path,
        }
    }
}

fn setting_bool(app: &AppHandle, key: &str, default_value: bool) -> bool {
    super::settings::get_setting_value(app.clone(), key.to_string())
        .ok()
        .flatten()
        .and_then(|value| value.as_bool())
        .unwrap_or(default_value)
}

fn setting_string(app: &AppHandle, key: &str) -> String {
    super::settings::get_setting_value(app.clone(), key.to_string())
        .ok()
        .flatten()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn setting_i64(app: &AppHandle, key: &str, default_value: i64) -> i64 {
    super::settings::get_setting_value(app.clone(), key.to_string())
        .ok()
        .flatten()
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
                .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
        })
        .unwrap_or(default_value)
}

fn normalize_application_key(value: &str) -> String {
    let cleaned = value
        .trim()
        .replace('\\', "/")
        .split('/')
        .last()
        .unwrap_or(value)
        .to_lowercase()
        .trim_end_matches(".exe")
        .to_string();

    cleaned
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn parse_blacklist(value: &str) -> HashSet<String> {
    value
        .split(|ch| matches!(ch, '\n' | ',' | ';'))
        .map(normalize_application_key)
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn sorted_blacklist_entries(app: &AppHandle) -> Vec<String> {
    let mut entries = parse_blacklist(&setting_string(app, BLACKLIST_KEY))
        .into_iter()
        .collect::<Vec<_>>();
    entries.sort();
    entries
}

fn application_candidates(application: &PrivacyForegroundApplication) -> Vec<String> {
    let mut candidates = [
        Some(application.id.as_str()),
        Some(application.name.as_str()),
        application.bundle_id.as_deref(),
        application.executable_path.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(normalize_application_key)
    .filter(|entry| !entry.is_empty())
    .collect::<Vec<_>>();
    candidates.sort();
    candidates.dedup();
    candidates
}

pub fn set_active_foreground_application(
    app: &AppHandle,
    application: &PrivacyForegroundApplication,
) -> Result<(), String> {
    super::settings::set_setting_value(
        app.clone(),
        ACTIVE_FOREGROUND_KEY.to_string(),
        serde_json::to_value(application).map_err(|e| e.to_string())?,
    )?;
    super::settings::set_setting_value(
        app.clone(),
        ACTIVE_FOREGROUND_ID_KEY.to_string(),
        serde_json::Value::String(application.id.clone()),
    )
}

pub fn clear_active_foreground_application(app: &AppHandle) -> Result<(), String> {
    super::settings::remove_setting_value(app.clone(), ACTIVE_FOREGROUND_KEY.to_string())?;
    super::settings::remove_setting_value(app.clone(), ACTIVE_FOREGROUND_ID_KEY.to_string())
}

pub fn active_foreground_application(app: &AppHandle) -> Option<PrivacyForegroundApplication> {
    super::settings::get_setting_value(app.clone(), ACTIVE_FOREGROUND_KEY.to_string())
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_value::<PrivacyForegroundApplication>(value).ok())
}

pub fn is_application_blacklisted(
    app: &AppHandle,
    application: &PrivacyForegroundApplication,
) -> bool {
    let blacklist = parse_blacklist(&setting_string(app, BLACKLIST_KEY));
    if blacklist.is_empty() {
        return false;
    }

    application_candidates(application)
        .iter()
        .any(|candidate| blacklist.contains(candidate))
}

pub fn should_skip_transcription_history(app: &AppHandle) -> bool {
    if !setting_bool(app, PAUSE_HISTORY_KEY, true) {
        return false;
    }

    active_foreground_application(app)
        .as_ref()
        .map(|application| is_application_blacklisted(app, application))
        .unwrap_or(false)
}

pub fn should_skip_clipboard_capture(app: &AppHandle) -> bool {
    if !setting_bool(app, PAUSE_CLIPBOARD_KEY, true) {
        return false;
    }

    match super::window::detect_foreground_application() {
        Ok(Some(application)) => {
            let application = PrivacyForegroundApplication {
                id: application.id,
                name: application.name,
                platform: application.platform,
                process_id: application.process_id,
                bundle_id: application.bundle_id,
                executable_path: application.executable_path,
            };
            is_application_blacklisted(app, &application)
        }
        _ => false,
    }
}

pub fn history_retention_days(app: &AppHandle) -> Option<i64> {
    if !setting_bool(app, AUTO_DELETE_HISTORY_KEY, false) {
        return None;
    }

    let days = setting_i64(
        app,
        HISTORY_RETENTION_DAYS_KEY,
        DEFAULT_HISTORY_RETENTION_DAYS,
    );
    if days <= 0 {
        return None;
    }

    Some(days.min(3650))
}

fn build_privacy_diagnostics_snapshot(
    detected_foreground: Option<PrivacyForegroundApplication>,
    active_foreground: Option<PrivacyForegroundApplication>,
    application_blacklist: Vec<String>,
    pause_history_in_blacklisted_apps: bool,
    pause_clipboard_in_blacklisted_apps: bool,
    auto_delete_history_enabled: bool,
    history_retention_days: i64,
    effective_history_retention_days: Option<i64>,
    detection_error: Option<String>,
) -> PrivacyDiagnostics {
    let detected_candidates = detected_foreground
        .as_ref()
        .map(application_candidates)
        .unwrap_or_default();
    let active_candidates = active_foreground
        .as_ref()
        .map(application_candidates)
        .unwrap_or_default();
    let detected_application_blacklisted = detected_candidates
        .iter()
        .any(|candidate| application_blacklist.contains(candidate));
    let active_application_blacklisted = active_candidates
        .iter()
        .any(|candidate| application_blacklist.contains(candidate));

    PrivacyDiagnostics {
        detected_foreground,
        active_foreground,
        application_blacklist,
        detected_candidates,
        active_candidates,
        detected_application_blacklisted,
        active_application_blacklisted,
        pause_history_in_blacklisted_apps,
        pause_clipboard_in_blacklisted_apps,
        auto_delete_history_enabled,
        history_retention_days,
        effective_history_retention_days,
        would_skip_transcription_history: pause_history_in_blacklisted_apps
            && active_application_blacklisted,
        would_skip_clipboard_capture: pause_clipboard_in_blacklisted_apps
            && detected_application_blacklisted,
        detection_error,
    }
}

#[tauri::command]
pub fn privacy_diagnostics(app: AppHandle) -> PrivacyDiagnostics {
    let detection = super::window::detect_foreground_application();
    let detection_error = detection.as_ref().err().cloned();
    let detected_foreground = detection
        .ok()
        .flatten()
        .map(PrivacyForegroundApplication::from);
    let active_foreground = active_foreground_application(&app);
    let application_blacklist = sorted_blacklist_entries(&app);
    let pause_history_in_blacklisted_apps = setting_bool(&app, PAUSE_HISTORY_KEY, true);
    let pause_clipboard_in_blacklisted_apps = setting_bool(&app, PAUSE_CLIPBOARD_KEY, true);
    let auto_delete_history_enabled = setting_bool(&app, AUTO_DELETE_HISTORY_KEY, false);
    let configured_history_retention_days = setting_i64(
        &app,
        HISTORY_RETENTION_DAYS_KEY,
        DEFAULT_HISTORY_RETENTION_DAYS,
    )
    .clamp(1, 3650);
    let effective_history_retention_days = history_retention_days(&app);

    build_privacy_diagnostics_snapshot(
        detected_foreground,
        active_foreground,
        application_blacklist,
        pause_history_in_blacklisted_apps,
        pause_clipboard_in_blacklisted_apps,
        auto_delete_history_enabled,
        configured_history_retention_days,
        effective_history_retention_days,
        detection_error,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_application() -> PrivacyForegroundApplication {
        PrivacyForegroundApplication {
            id: "com.company.Secret-App".to_string(),
            name: "Secret App".to_string(),
            platform: "windows".to_string(),
            process_id: Some(42),
            bundle_id: Some("com.company.Secret-App".to_string()),
            executable_path: Some("C:\\Program Files\\Secret App\\Secret App.exe".to_string()),
        }
    }

    fn clear_application() -> PrivacyForegroundApplication {
        PrivacyForegroundApplication {
            id: "com.company.Clear-App".to_string(),
            name: "Clear App".to_string(),
            platform: "windows".to_string(),
            process_id: Some(7),
            bundle_id: Some("com.company.Clear-App".to_string()),
            executable_path: Some("C:\\Program Files\\Clear App\\Clear App.exe".to_string()),
        }
    }

    #[test]
    fn normalizes_application_keys_like_the_renderer_privacy_path() {
        assert_eq!(
            normalize_application_key("C:\\Program Files\\Secret App\\Secret App.exe"),
            "secret-app"
        );
        assert_eq!(normalize_application_key("Secret App"), "secret-app");
        assert_eq!(
            normalize_application_key("com.company.Secret-App"),
            "com.company.secret-app"
        );
    }

    #[test]
    fn parses_blacklist_entries_from_common_delimiters() {
        let entries = parse_blacklist("Secret App; com.company.Secret-App\nOther App");

        assert!(entries.contains("secret-app"));
        assert!(entries.contains("com.company.secret-app"));
        assert!(entries.contains("other-app"));
    }

    #[test]
    fn builds_application_candidates_from_identity_and_path() {
        let candidates = application_candidates(&sample_application());

        assert!(candidates.contains(&"com.company.secret-app".to_string()));
        assert!(candidates.contains(&"secret-app".to_string()));
    }

    #[test]
    fn diagnostics_use_active_app_for_history_and_detected_app_for_clipboard() {
        let blacklist = vec!["secret-app".to_string()];
        let active_blacklisted = build_privacy_diagnostics_snapshot(
            Some(clear_application()),
            Some(sample_application()),
            blacklist.clone(),
            true,
            true,
            false,
            DEFAULT_HISTORY_RETENTION_DAYS,
            None,
            None,
        );

        assert!(active_blacklisted.active_application_blacklisted);
        assert!(!active_blacklisted.detected_application_blacklisted);
        assert!(active_blacklisted.would_skip_transcription_history);
        assert!(!active_blacklisted.would_skip_clipboard_capture);

        let detected_blacklisted = build_privacy_diagnostics_snapshot(
            Some(sample_application()),
            Some(clear_application()),
            blacklist,
            true,
            true,
            false,
            DEFAULT_HISTORY_RETENTION_DAYS,
            None,
            None,
        );

        assert!(!detected_blacklisted.active_application_blacklisted);
        assert!(detected_blacklisted.detected_application_blacklisted);
        assert!(!detected_blacklisted.would_skip_transcription_history);
        assert!(detected_blacklisted.would_skip_clipboard_capture);
    }

    #[test]
    fn diagnostics_without_active_app_do_not_skip_history() {
        let diagnostics = build_privacy_diagnostics_snapshot(
            Some(sample_application()),
            None,
            vec!["secret-app".to_string()],
            true,
            true,
            false,
            DEFAULT_HISTORY_RETENTION_DAYS,
            None,
            None,
        );

        assert!(diagnostics.detected_application_blacklisted);
        assert!(!diagnostics.active_application_blacklisted);
        assert!(!diagnostics.would_skip_transcription_history);
        assert!(diagnostics.would_skip_clipboard_capture);
    }
}
