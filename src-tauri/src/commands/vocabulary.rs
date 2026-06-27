use std::collections::HashSet;

#[cfg(target_os = "macos")]
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Deserialize, Serialize)]
struct SnippetReplacement {
    trigger: String,
    replacement: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct VocabularyLayers {
    #[serde(default = "default_schema_version")]
    schema_version: u8,
    #[serde(default)]
    hotwords: Vec<VocabularyHotwordEntry>,
    #[serde(default)]
    snippets: Vec<VocabularySnippetEntry>,
    #[serde(default)]
    context_packs: Vec<VocabularyContextPack>,
    #[serde(default)]
    active_context_pack_ids: Vec<String>,
    #[serde(default)]
    active_profile_id: Option<String>,
    #[serde(default)]
    active_application_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct VocabularyContextPack {
    id: String,
    name: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct VocabularyHotwordEntry {
    id: String,
    word: String,
    scope: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    application_id: Option<String>,
    #[serde(default)]
    context_pack_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct VocabularySnippetEntry {
    id: String,
    trigger: String,
    replacement: String,
    scope: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    application_id: Option<String>,
    #[serde(default)]
    context_pack_id: Option<String>,
}

fn default_schema_version() -> u8 {
    1
}

fn default_true() -> bool {
    true
}

fn clean_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn normalize_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn normalize_word_key(value: &str) -> String {
    clean_text(value).to_lowercase()
}

pub fn load_effective_hotwords(app: &AppHandle) -> Vec<String> {
    match super::settings::get_setting_value(app.clone(), "vocabularyEffectiveHotwords".to_string())
    {
        Ok(Some(value)) => serde_json::from_value::<Vec<String>>(value).unwrap_or_default(),
        _ => Vec::new(),
    }
    .into_iter()
    .map(|word| word.trim().to_string())
    .filter(|word| !word.is_empty())
    .collect()
}

fn is_context_pack_active(layers: &VocabularyLayers, context_pack_id: Option<&str>) -> bool {
    let Some(context_pack_id) = context_pack_id.map(clean_text).filter(|id| !id.is_empty()) else {
        return false;
    };
    if !layers
        .active_context_pack_ids
        .iter()
        .any(|id| id == &context_pack_id)
    {
        return false;
    }

    layers
        .context_packs
        .iter()
        .find(|pack| pack.id == context_pack_id)
        .map(|pack| pack.enabled)
        .unwrap_or(false)
}

fn is_hotword_entry_active(layers: &VocabularyLayers, entry: &VocabularyHotwordEntry) -> bool {
    if !entry.enabled {
        return false;
    }
    match entry.scope.as_str() {
        "global" => true,
        "profile" => entry.profile_id == layers.active_profile_id && entry.profile_id.is_some(),
        "application" => {
            entry.application_id == layers.active_application_id && entry.application_id.is_some()
        }
        "contextPack" => is_context_pack_active(layers, entry.context_pack_id.as_deref()),
        _ => false,
    }
}

fn is_snippet_entry_active(layers: &VocabularyLayers, entry: &VocabularySnippetEntry) -> bool {
    if !entry.enabled {
        return false;
    }
    match entry.scope.as_str() {
        "global" => true,
        "profile" => entry.profile_id == layers.active_profile_id && entry.profile_id.is_some(),
        "application" => {
            entry.application_id == layers.active_application_id && entry.application_id.is_some()
        }
        "contextPack" => is_context_pack_active(layers, entry.context_pack_id.as_deref()),
        _ => false,
    }
}

fn is_non_global_scope(scope: &str) -> bool {
    matches!(scope, "profile" | "application" | "contextPack")
}

fn settings_bool(app: &AppHandle, key: &str, fallback: bool) -> bool {
    match super::settings::get_setting_value(app.clone(), "vocabularySettings".to_string()) {
        Ok(Some(value)) => value
            .get(key)
            .and_then(|value| value.as_bool())
            .unwrap_or(fallback),
        _ => fallback,
    }
}

fn unique_hotwords(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for value in values {
        let cleaned = clean_text(&value);
        let key = normalize_word_key(&cleaned);
        if cleaned.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        result.push(cleaned);
    }
    result
}

fn unique_snippets(values: Vec<SnippetReplacement>) -> Vec<SnippetReplacement> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for snippet in values {
        let trigger = clean_text(&snippet.trigger);
        let replacement = clean_text(&snippet.replacement);
        let key = normalize_key(&trigger);
        if trigger.is_empty()
            || replacement.is_empty()
            || key == normalize_key(&replacement)
            || seen.contains(&key)
        {
            continue;
        }
        seen.insert(key);
        result.push(SnippetReplacement {
            trigger,
            replacement,
        });
    }
    result
}

fn recompute_effective_hotwords(app: &AppHandle, layers: &VocabularyLayers) -> Vec<String> {
    if !settings_bool(app, "hotwordsEnabled", true) {
        return Vec::new();
    }

    let scoped_keys = layers
        .hotwords
        .iter()
        .filter(|entry| is_non_global_scope(&entry.scope))
        .map(|entry| normalize_word_key(&entry.word))
        .collect::<HashSet<_>>();
    let mut values = load_effective_hotwords(app)
        .into_iter()
        .filter(|word| !scoped_keys.contains(&normalize_word_key(word)))
        .collect::<Vec<_>>();

    if values.is_empty() {
        values.extend(
            layers
                .hotwords
                .iter()
                .filter(|entry| entry.scope == "global" && entry.enabled)
                .map(|entry| entry.word.clone()),
        );
    }

    values.extend(
        layers
            .hotwords
            .iter()
            .filter(|entry| is_non_global_scope(&entry.scope))
            .filter(|entry| is_hotword_entry_active(layers, entry))
            .map(|entry| entry.word.clone()),
    );

    unique_hotwords(values)
}

fn recompute_effective_snippets(
    app: &AppHandle,
    layers: &VocabularyLayers,
) -> Vec<SnippetReplacement> {
    if !settings_bool(app, "snippetsEnabled", true) {
        return Vec::new();
    }

    let scoped_keys = layers
        .snippets
        .iter()
        .filter(|entry| is_non_global_scope(&entry.scope))
        .map(|entry| normalize_key(&entry.trigger))
        .collect::<HashSet<_>>();
    let mut values = load_effective_snippets(app)
        .into_iter()
        .filter(|snippet| !scoped_keys.contains(&normalize_key(&snippet.trigger)))
        .collect::<Vec<_>>();

    if values.is_empty() {
        values.extend(
            layers
                .snippets
                .iter()
                .filter(|entry| entry.scope == "global" && entry.enabled)
                .map(|entry| SnippetReplacement {
                    trigger: entry.trigger.clone(),
                    replacement: entry.replacement.clone(),
                }),
        );
    }

    values.extend(
        layers
            .snippets
            .iter()
            .filter(|entry| is_non_global_scope(&entry.scope))
            .filter(|entry| is_snippet_entry_active(layers, entry))
            .map(|entry| SnippetReplacement {
                trigger: entry.trigger.clone(),
                replacement: entry.replacement.clone(),
            }),
    );

    unique_snippets(values)
}

fn persist_layers_and_effective_vocabulary(
    app: &AppHandle,
    layers: &VocabularyLayers,
) -> Result<(), String> {
    let layers_value = serde_json::to_value(layers).map_err(|e| e.to_string())?;

    super::settings::set_setting_value(
        app.clone(),
        "vocabularyLayers".to_string(),
        layers_value.clone(),
    )?;

    if let Some(mut settings_value) =
        super::settings::get_setting_value(app.clone(), "vocabularySettings".to_string())?
    {
        if let Some(settings) = settings_value.as_object_mut() {
            settings.insert("layers".to_string(), layers_value.clone());
            super::settings::set_setting_value(
                app.clone(),
                "vocabularySettings".to_string(),
                settings_value,
            )?;
        }
    }

    super::settings::set_setting_value(
        app.clone(),
        "vocabularyEffectiveHotwords".to_string(),
        serde_json::to_value(recompute_effective_hotwords(app, layers))
            .map_err(|e| e.to_string())?,
    )?;
    super::settings::set_setting_value(
        app.clone(),
        "vocabularyEffectiveSnippets".to_string(),
        serde_json::to_value(recompute_effective_snippets(app, layers))
            .map_err(|e| e.to_string())?,
    )
}

pub fn sync_active_application(app: &AppHandle, application_id: &str) -> Result<(), String> {
    let Some(value) =
        super::settings::get_setting_value(app.clone(), "vocabularyLayers".to_string())?
    else {
        return Ok(());
    };
    let mut layers = serde_json::from_value::<VocabularyLayers>(value)
        .map_err(|e| format!("Invalid vocabularyLayers setting: {e}"))?;
    let cleaned_application_id = clean_text(application_id);
    if cleaned_application_id.is_empty() {
        return clear_active_application(app);
    }

    layers.active_application_id = Some(cleaned_application_id);
    persist_layers_and_effective_vocabulary(app, &layers)?;

    Ok(())
}

pub fn clear_active_application(app: &AppHandle) -> Result<(), String> {
    let Some(value) =
        super::settings::get_setting_value(app.clone(), "vocabularyLayers".to_string())?
    else {
        return Ok(());
    };
    let mut layers = serde_json::from_value::<VocabularyLayers>(value)
        .map_err(|e| format!("Invalid vocabularyLayers setting: {e}"))?;
    layers.active_application_id = None;
    persist_layers_and_effective_vocabulary(app, &layers)
}

fn load_effective_snippets(app: &AppHandle) -> Vec<SnippetReplacement> {
    match super::settings::get_setting_value(app.clone(), "vocabularyEffectiveSnippets".to_string())
    {
        Ok(Some(value)) => {
            serde_json::from_value::<Vec<SnippetReplacement>>(value).unwrap_or_default()
        }
        _ => Vec::new(),
    }
    .into_iter()
    .filter(|snippet| {
        let trigger = snippet.trigger.trim();
        let replacement = snippet.replacement.trim();
        !trigger.is_empty() && !replacement.is_empty() && trigger != replacement
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_layers(active_application_id: Option<&str>) -> VocabularyLayers {
        VocabularyLayers {
            schema_version: 1,
            hotwords: Vec::new(),
            snippets: Vec::new(),
            context_packs: vec![VocabularyContextPack {
                id: "pack-a".to_string(),
                name: "Pack A".to_string(),
                enabled: true,
                created_at: String::new(),
            }],
            active_context_pack_ids: vec!["pack-a".to_string()],
            active_profile_id: None,
            active_application_id: active_application_id.map(str::to_string),
        }
    }

    fn hotword(scope: &str, word: &str, application_id: Option<&str>) -> VocabularyHotwordEntry {
        VocabularyHotwordEntry {
            id: format!("{scope}:{word}"),
            word: word.to_string(),
            scope: scope.to_string(),
            enabled: true,
            created_at: String::new(),
            profile_id: None,
            application_id: application_id.map(str::to_string),
            context_pack_id: (scope == "contextPack").then(|| "pack-a".to_string()),
        }
    }

    fn snippet(
        scope: &str,
        trigger: &str,
        replacement: &str,
        application_id: Option<&str>,
    ) -> VocabularySnippetEntry {
        VocabularySnippetEntry {
            id: format!("{scope}:{trigger}"),
            trigger: trigger.to_string(),
            replacement: replacement.to_string(),
            scope: scope.to_string(),
            enabled: true,
            created_at: String::new(),
            profile_id: None,
            application_id: application_id.map(str::to_string),
            context_pack_id: (scope == "contextPack").then(|| "pack-a".to_string()),
        }
    }

    #[test]
    fn cleared_active_application_disables_only_application_scoped_entries() {
        let layers = base_layers(None);

        assert!(is_hotword_entry_active(
            &layers,
            &hotword("global", "GlobalTerm", None)
        ));
        assert!(is_hotword_entry_active(
            &layers,
            &hotword("contextPack", "PackTerm", None)
        ));
        assert!(!is_hotword_entry_active(
            &layers,
            &hotword("application", "MailTerm", Some("mail"))
        ));
        assert!(is_snippet_entry_active(
            &layers,
            &snippet("global", "global phrase", "Global Phrase", None)
        ));
        assert!(is_snippet_entry_active(
            &layers,
            &snippet("contextPack", "pack phrase", "Pack Phrase", None)
        ));
        assert!(!is_snippet_entry_active(
            &layers,
            &snippet("application", "mail phrase", "Mail Phrase", Some("mail"))
        ));
    }

    #[test]
    fn active_application_enables_matching_application_scoped_entries() {
        let layers = base_layers(Some("mail"));

        assert!(is_hotword_entry_active(
            &layers,
            &hotword("application", "MailTerm", Some("mail"))
        ));
        assert!(!is_hotword_entry_active(
            &layers,
            &hotword("application", "CodeTerm", Some("code"))
        ));
        assert!(is_snippet_entry_active(
            &layers,
            &snippet("application", "mail phrase", "Mail Phrase", Some("mail"))
        ));
        assert!(!is_snippet_entry_active(
            &layers,
            &snippet("application", "code phrase", "Code Phrase", Some("code"))
        ));
    }
}

#[cfg(target_os = "macos")]
pub fn apply_snippet_replacements(app: &AppHandle, text: &str) -> String {
    let snippets = load_effective_snippets(app);
    if text.is_empty() || snippets.is_empty() {
        return text.to_string();
    }

    let mut result = text.to_string();
    for snippet in snippets {
        let Some(pattern) = build_flexible_pattern(&snippet.trigger) else {
            continue;
        };
        let Ok(regex) = Regex::new(&pattern) else {
            continue;
        };
        let replacement = snippet.replacement.clone();
        result = regex
            .replace_all(&result, |caps: &Captures| {
                let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                format!("{prefix}{replacement}")
            })
            .to_string();
    }

    result
}

#[cfg(target_os = "macos")]
fn build_flexible_pattern(trigger: &str) -> Option<String> {
    let chars = trigger
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .map(|ch| regex::escape(&ch.to_string()))
        .collect::<Vec<_>>();

    if chars.is_empty() {
        return None;
    }

    Some(format!(
        "(?i)(^|[^a-zA-Z0-9])({})(?![a-zA-Z0-9])",
        chars.join(r"\s*")
    ))
}
