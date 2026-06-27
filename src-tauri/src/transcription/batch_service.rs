use tauri::AppHandle;
use tokio::time::{timeout, Duration};

use crate::commands::{
    command_error::{CommandError, CommandResult},
    settings, vocabulary,
};

use super::domain::{
    emit_transcript_event, BatchProviderContext, BatchTranscriptionRequest, TranscriptEvent,
    BATCH_TRANSCRIPT_EVENT_NAME,
};
use super::providers::{BatchProvider, BatchProviderCredentials};

fn normalize_batch_session_id(session_id: Option<String>) -> Option<String> {
    session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn trim_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn append_url_path(base: &str, path: &str) -> String {
    format!("{}{}", trim_url(base), path)
}

fn strip_case_insensitive_suffix(value: &str, suffix: &str, replacement: &str) -> Option<String> {
    let normalized = trim_url(value);
    let lower = normalized.to_ascii_lowercase();
    if lower.ends_with(suffix) {
        let keep_len = normalized.len() - suffix.len();
        return Some(trim_url(&format!(
            "{}{}",
            &normalized[..keep_len],
            replacement
        )));
    }
    None
}

fn is_private_endpoint_host(hostname: &str) -> bool {
    let host = hostname
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();

    if host == "localhost" || host == "0.0.0.0" || host.starts_with("127.") {
        return true;
    }
    if host == "::1" {
        return true;
    }
    if host.starts_with("10.") || host.starts_with("192.168.") || host.starts_with("169.254.") {
        return true;
    }
    if let Some(rest) = host.strip_prefix("172.") {
        if let Some(octet) = rest
            .split('.')
            .next()
            .and_then(|value| value.parse::<u8>().ok())
        {
            if (16..=31).contains(&octet) {
                return true;
            }
        }
    }
    if host.contains(':')
        && (host.starts_with("fe80") || host.starts_with("fc") || host.starts_with("fd"))
    {
        return true;
    }
    host.ends_with(".local")
}

fn is_allowed_endpoint_url(url: &reqwest::Url) -> bool {
    match url.scheme() {
        "https" => true,
        "http" => url.host_str().is_some_and(is_private_endpoint_host),
        _ => false,
    }
}

fn normalize_openai_compatible_endpoint(raw: &str) -> String {
    let normalized = trim_url(raw);
    let lower = normalized.to_ascii_lowercase();
    if lower.ends_with("/audio/transcriptions") {
        return normalized;
    }
    append_url_path(&normalized, "/audio/transcriptions")
}

fn normalize_zai_endpoint(raw: &str) -> String {
    let normalized = trim_url(raw);
    let lower = normalized.to_ascii_lowercase();
    if lower.ends_with("/paas/v4/audio/transcriptions") {
        return normalized;
    }
    append_url_path(&normalized, "/paas/v4/audio/transcriptions")
}

fn normalize_assemblyai_base(raw: &str) -> String {
    let normalized = trim_url(raw);
    let lower = normalized.to_ascii_lowercase();
    if let Some(index) = lower.find("/v2/transcript/") {
        return trim_url(&normalized[..index + "/v2".len()]);
    }
    strip_case_insensitive_suffix(&normalized, "/v2/upload", "/v2")
        .or_else(|| strip_case_insensitive_suffix(&normalized, "/v2/transcript", "/v2"))
        .unwrap_or(normalized)
}

fn normalize_batch_endpoint_override(
    provider: BatchProvider,
    endpoint_override: Option<String>,
) -> CommandResult<Option<String>> {
    let Some(raw_endpoint) = endpoint_override
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    if provider == BatchProvider::Volcengine {
        return Err(CommandError::configuration(
            "Volcengine transcription endpoint is managed by the backend protocol",
        ));
    }

    let parsed = reqwest::Url::parse(&raw_endpoint)
        .map_err(|_| CommandError::configuration("Invalid transcription endpoint override URL"))?;
    if !is_allowed_endpoint_url(&parsed) {
        return Err(CommandError::configuration(
            "Transcription endpoint override must use HTTPS or a private/local HTTP host",
        ));
    }

    let normalized = match provider {
        BatchProvider::AssemblyAI => normalize_assemblyai_base(&raw_endpoint),
        BatchProvider::OpenAI | BatchProvider::Groq => {
            normalize_openai_compatible_endpoint(&raw_endpoint)
        }
        BatchProvider::Zai => normalize_zai_endpoint(&raw_endpoint),
        BatchProvider::Volcengine => unreachable!("Volcengine override handled above"),
    };

    Ok(Some(normalized))
}

fn load_batch_provider_context(
    app: &AppHandle,
    credentials: BatchProviderCredentials,
) -> CommandResult<BatchProviderContext> {
    match credentials {
        BatchProviderCredentials::ApiKey(key_name) => {
            let api_key =
                settings::get_env_var(app.clone(), key_name.to_string())?.ok_or_else(|| {
                    CommandError::configuration(format!(
                        "{key_name} not found. Please set your API key."
                    ))
                })?;
            Ok(BatchProviderContext::api_key(api_key))
        }
        BatchProviderCredentials::Volcengine {
            app_id_key,
            access_token_key,
            resource_id,
        } => {
            let app_id =
                settings::get_env_var(app.clone(), app_id_key.to_string())?.unwrap_or_default();
            let access_token = settings::get_env_var(app.clone(), access_token_key.to_string())?
                .ok_or_else(|| {
                    CommandError::configuration(
                        "VOLCENGINE_ACCESS_TOKEN not found. Please set your Volcengine API Key or Access Token.",
                    )
                })?;
            let hotwords = vocabulary::load_effective_hotwords(app);

            Ok(BatchProviderContext::volcengine(
                app_id,
                access_token,
                resource_id.to_string(),
                hotwords,
            ))
        }
    }
}

pub(crate) async fn transcribe_audio(
    app: AppHandle,
    audio_data: Vec<u8>,
    provider: String,
    model: Option<String>,
    language: Option<String>,
    session_id: Option<String>,
    endpoint_override: Option<String>,
) -> CommandResult<String> {
    let session_id = normalize_batch_session_id(session_id);
    let transcription_prompt =
        settings::get_setting_value(app.clone(), "transcriptionPrompt".to_string())?
            .and_then(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty());

    let batch_provider = BatchProvider::from_id(&provider)
        .ok_or_else(|| CommandError::configuration(format!("Unknown provider: {}", provider)))?;
    let batch_provider_id = batch_provider.id();
    let timeout_message = batch_provider.timeout_message();
    let context = load_batch_provider_context(&app, batch_provider.credentials())?;
    let endpoint_override = normalize_batch_endpoint_override(batch_provider, endpoint_override)?;

    let request = BatchTranscriptionRequest {
        audio_data,
        context,
        model,
        language,
        prompt: transcription_prompt,
        session_id,
        endpoint_override,
    };
    let request_session_id = request.session_id.clone();

    let result = timeout(Duration::from_secs(60), batch_provider.transcribe(request))
        .await
        .map_err(|_| CommandError::timeout(timeout_message))??;

    eprintln!(
        "[transcription] batch provider={} reported_provider={} session_id={} chars={}",
        batch_provider_id,
        result.provider_id,
        request_session_id.as_deref().unwrap_or("none"),
        result.text.len()
    );

    if let Some(session_id) = request_session_id {
        emit_transcript_event(
            &app,
            BATCH_TRANSCRIPT_EVENT_NAME,
            TranscriptEvent::batch_final(result.provider_id, session_id, result.text.clone()),
        );
    }

    Ok(result.text)
}

#[cfg(test)]
mod tests {
    use crate::commands::command_error::CommandErrorKind;

    use super::{normalize_batch_endpoint_override, normalize_batch_session_id};
    use crate::transcription::providers::BatchProvider;

    #[test]
    fn normalizes_optional_batch_session_id() {
        assert_eq!(
            normalize_batch_session_id(Some(" renderer-session ".to_string())),
            Some("renderer-session".to_string())
        );
        assert_eq!(normalize_batch_session_id(Some("   ".to_string())), None);
        assert_eq!(normalize_batch_session_id(None), None);
    }

    #[test]
    fn normalizes_provider_endpoint_overrides() {
        assert_eq!(
            normalize_batch_endpoint_override(
                BatchProvider::OpenAI,
                Some("https://api.openai.com/v1".to_string())
            )
            .unwrap(),
            Some("https://api.openai.com/v1/audio/transcriptions".to_string())
        );
        assert_eq!(
            normalize_batch_endpoint_override(
                BatchProvider::Groq,
                Some("https://api.groq.com/openai/v1/audio/transcriptions".to_string())
            )
            .unwrap(),
            Some("https://api.groq.com/openai/v1/audio/transcriptions".to_string())
        );
        assert_eq!(
            normalize_batch_endpoint_override(
                BatchProvider::Zai,
                Some("https://api.z.ai/api".to_string())
            )
            .unwrap(),
            Some("https://api.z.ai/api/paas/v4/audio/transcriptions".to_string())
        );
        assert_eq!(
            normalize_batch_endpoint_override(
                BatchProvider::AssemblyAI,
                Some("https://api.assemblyai.com/v2/upload".to_string())
            )
            .unwrap(),
            Some("https://api.assemblyai.com/v2".to_string())
        );
        assert_eq!(
            normalize_batch_endpoint_override(
                BatchProvider::OpenAI,
                Some("http://localhost:11434/v1".to_string())
            )
            .unwrap(),
            Some("http://localhost:11434/v1/audio/transcriptions".to_string())
        );
    }

    #[test]
    fn rejects_unsupported_endpoint_overrides() {
        let public_http_error = normalize_batch_endpoint_override(
            BatchProvider::OpenAI,
            Some("http://example.com/v1".to_string()),
        )
        .expect_err("public http endpoint should be rejected");
        assert_eq!(public_http_error.kind, CommandErrorKind::Configuration);

        let volcengine_error = normalize_batch_endpoint_override(
            BatchProvider::Volcengine,
            Some("https://example.com/transcribe".to_string()),
        )
        .expect_err("Volcengine endpoint override should be rejected");
        assert_eq!(volcengine_error.kind, CommandErrorKind::Configuration);
    }
}
