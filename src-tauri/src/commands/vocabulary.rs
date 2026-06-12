use regex::{Captures, Regex};
use serde::Deserialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Deserialize)]
struct SnippetReplacement {
    trigger: String,
    replacement: String,
}

pub fn load_effective_hotwords(app: &AppHandle) -> Vec<String> {
    match super::settings::get_setting(app.clone(), "vocabularyEffectiveHotwords".to_string()) {
        Ok(Some(value)) => serde_json::from_value::<Vec<String>>(value).unwrap_or_default(),
        _ => Vec::new(),
    }
    .into_iter()
    .map(|word| word.trim().to_string())
    .filter(|word| !word.is_empty())
    .collect()
}

fn load_effective_snippets(app: &AppHandle) -> Vec<SnippetReplacement> {
    match super::settings::get_setting(app.clone(), "vocabularyEffectiveSnippets".to_string()) {
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
