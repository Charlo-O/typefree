use serde::Deserialize;

use crate::commands::command_error::CommandResult;

use super::super::domain::{
    detect_audio_part_metadata, BatchTranscriptionRequest, BatchTranscriptionResult,
    TranscriptionProvider,
};
use super::{provider_batch_url, BatchProvider};

pub(super) struct GroqProvider;

impl TranscriptionProvider for GroqProvider {
    fn id(&self) -> &'static str {
        "groq"
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
        let text = transcribe_groq(audio_data, api_key, model, language, endpoint_override).await?;
        Ok(BatchTranscriptionResult::new(self.id(), text))
    }
}

async fn transcribe_groq(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
    endpoint_override: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = normalize_groq_model(model);
    let endpoint = groq_transcription_endpoint(endpoint_override);

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
        return Err(format!("Groq API error: {}", error_text));
    }

    #[derive(Deserialize)]
    struct GroqResponse {
        text: String,
    }

    let result: GroqResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(result.text)
}

fn normalize_groq_model(model: Option<String>) -> String {
    match model.as_deref() {
        Some(model) if !model.trim().is_empty() => model.to_string(),
        _ => "whisper-large-v3-turbo".to_string(),
    }
}

fn groq_transcription_endpoint(endpoint_override: Option<String>) -> String {
    provider_batch_url(BatchProvider::Groq, endpoint_override)
}

#[cfg(test)]
mod tests {
    use crate::transcription::providers::{provider_batch_url, BatchProvider};

    use super::{groq_transcription_endpoint, normalize_groq_model};

    #[test]
    fn normalizes_groq_batch_model_defaults() {
        assert_eq!(normalize_groq_model(None), "whisper-large-v3-turbo");
        assert_eq!(
            normalize_groq_model(Some("whisper-large-v3".to_string())),
            "whisper-large-v3"
        );
    }

    #[test]
    fn resolves_groq_transcription_endpoint() {
        assert_eq!(
            groq_transcription_endpoint(None),
            provider_batch_url(BatchProvider::Groq, None)
        );
        assert_eq!(
            groq_transcription_endpoint(Some(
                "https://groq-proxy.example.test/openai/v1/audio/transcriptions".to_string()
            )),
            "https://groq-proxy.example.test/openai/v1/audio/transcriptions"
        );
    }
}
