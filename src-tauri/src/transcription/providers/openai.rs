use serde::Deserialize;

use crate::commands::command_error::CommandResult;

use super::super::domain::{
    detect_audio_part_metadata, BatchTranscriptionRequest, BatchTranscriptionResult,
    TranscriptionProvider,
};
use super::{provider_batch_url, BatchProvider};

pub(super) struct OpenAIProvider;

impl TranscriptionProvider for OpenAIProvider {
    fn id(&self) -> &'static str {
        "openai"
    }

    async fn transcribe(
        &self,
        request: BatchTranscriptionRequest,
    ) -> CommandResult<BatchTranscriptionResult> {
        let BatchTranscriptionRequest {
            audio_data,
            context,
            model,
            language,
            prompt: _,
            session_id: _,
            endpoint_override,
        } = request;
        let api_key = context.into_api_key(self.id())?;
        let text =
            transcribe_openai(audio_data, api_key, model, language, endpoint_override).await?;
        Ok(BatchTranscriptionResult::new(self.id(), text))
    }
}

async fn transcribe_openai(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
    endpoint_override: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = normalize_openai_model(model);
    let endpoint = openai_transcription_endpoint(endpoint_override);

    let metadata = detect_audio_part_metadata(&audio_data, "webm");
    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name(format!("audio.{}", metadata.extension))
        .mime_str(metadata.mime_type)
        .map_err(|e| e.to_string())?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model);

    if let Some(lang) = language {
        if lang != "auto" {
            form = form.text("language", lang);
        }
    }

    let response = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error: {}", error_text));
    }

    #[derive(Deserialize)]
    struct OpenAIResponse {
        text: String,
    }

    let result: OpenAIResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(result.text)
}

fn normalize_openai_model(model: Option<String>) -> String {
    match model.as_deref() {
        Some("gpt-realtime-whisper") => "gpt-4o-mini-transcribe".to_string(),
        Some(model) if !model.trim().is_empty() => model.to_string(),
        _ => "whisper-1".to_string(),
    }
}

fn openai_transcription_endpoint(endpoint_override: Option<String>) -> String {
    provider_batch_url(BatchProvider::OpenAI, endpoint_override)
}

#[cfg(test)]
mod tests {
    use crate::transcription::providers::{provider_batch_url, BatchProvider};

    use super::{normalize_openai_model, openai_transcription_endpoint};

    #[test]
    fn normalizes_openai_batch_model_defaults() {
        assert_eq!(normalize_openai_model(None), "whisper-1");
        assert_eq!(
            normalize_openai_model(Some("gpt-realtime-whisper".to_string())),
            "gpt-4o-mini-transcribe"
        );
        assert_eq!(
            normalize_openai_model(Some("gpt-4o-mini-transcribe".to_string())),
            "gpt-4o-mini-transcribe"
        );
    }

    #[test]
    fn resolves_openai_transcription_endpoint() {
        assert_eq!(
            openai_transcription_endpoint(None),
            provider_batch_url(BatchProvider::OpenAI, None)
        );
        assert_eq!(
            openai_transcription_endpoint(Some(
                "https://proxy.example.test/v1/audio/transcriptions".to_string()
            )),
            "https://proxy.example.test/v1/audio/transcriptions"
        );
    }
}
