use serde::{Deserialize, Serialize};
use tokio::time::{sleep, Duration, Instant};

use crate::commands::command_error::CommandResult;

use super::super::domain::{
    BatchTranscriptionRequest, BatchTranscriptionResult, TranscriptionProvider,
};
use super::{provider_batch_url, BatchProvider};

pub(super) struct AssemblyAIProvider;

impl TranscriptionProvider for AssemblyAIProvider {
    fn id(&self) -> &'static str {
        "assemblyai"
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
            prompt,
            session_id: _,
            endpoint_override,
        } = request;
        let api_key = context.into_api_key(self.id())?;
        let text = transcribe_assemblyai(
            audio_data,
            api_key,
            model,
            language,
            prompt,
            endpoint_override,
        )
        .await?;
        Ok(BatchTranscriptionResult::new(self.id(), text))
    }
}

#[derive(Deserialize)]
struct AssemblyAIUploadResponse {
    upload_url: String,
}

#[derive(Serialize)]
struct AssemblyAITranscriptRequest {
    audio_url: String,
    speech_models: Vec<String>,
    language_detection: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
}

#[derive(Deserialize)]
struct AssemblyAITranscriptResponse {
    id: String,
}

#[derive(Deserialize)]
struct AssemblyAITranscriptStatus {
    status: String,
    text: Option<String>,
    error: Option<String>,
}

fn normalize_assemblyai_model(model: Option<String>) -> String {
    match model.as_deref() {
        Some("universal-2") => "universal-2".to_string(),
        _ => "universal-3-pro".to_string(),
    }
}

fn build_assemblyai_speech_models(model: &str) -> Vec<String> {
    if model == "universal-3-pro" {
        vec!["universal-3-pro".to_string(), "universal-2".to_string()]
    } else {
        vec![model.to_string()]
    }
}

fn assemblyai_prompt_for_model(model: &str, prompt: Option<String>) -> Option<String> {
    if model == "universal-3-pro" {
        prompt
    } else {
        None
    }
}

fn assemblyai_base_url(endpoint_override: Option<String>) -> String {
    provider_batch_url(BatchProvider::AssemblyAI, endpoint_override)
}

async fn transcribe_assemblyai(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
    prompt: Option<String>,
    endpoint_override: Option<String>,
) -> Result<String, String> {
    const POLL_INTERVAL_MS: u64 = 1_000;
    const MAX_WAIT_SECONDS: u64 = 180;

    let client = reqwest::Client::new();
    let model = normalize_assemblyai_model(model);
    let speech_models = build_assemblyai_speech_models(&model);
    let prompt = assemblyai_prompt_for_model(&model, prompt);
    let preferred_language = language.unwrap_or_else(|| "auto".to_string());
    let base_url = assemblyai_base_url(endpoint_override);

    eprintln!(
        "[assemblyai] submitting transcript model={} speech_models={:?} preferred_language={} language_detection=true includes_prompt={}",
        model,
        speech_models,
        preferred_language,
        prompt.is_some()
    );

    let upload_response = client
        .post(format!("{base_url}/upload"))
        .header("authorization", api_key.clone())
        .header("content-type", "application/octet-stream")
        .body(audio_data)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !upload_response.status().is_success() {
        let error_text = upload_response.text().await.unwrap_or_default();
        eprintln!("[assemblyai] upload failed status_text={}", error_text);
        return Err(format!("AssemblyAI upload failed: {}", error_text));
    }

    let upload_result: AssemblyAIUploadResponse =
        upload_response.json().await.map_err(|e| e.to_string())?;

    let transcript_request = AssemblyAITranscriptRequest {
        audio_url: upload_result.upload_url,
        speech_models: speech_models.clone(),
        language_detection: true,
        prompt,
    };

    let transcript_response = client
        .post(format!("{base_url}/transcript"))
        .header("authorization", api_key.clone())
        .json(&transcript_request)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !transcript_response.status().is_success() {
        let error_text = transcript_response.text().await.unwrap_or_default();
        eprintln!(
            "[assemblyai] transcript submission failed preferred_language={} speech_models={:?} error={}",
            preferred_language,
            speech_models,
            error_text
        );
        return Err(format!(
            "AssemblyAI transcript submission failed: {}",
            error_text
        ));
    }

    let transcript: AssemblyAITranscriptResponse = transcript_response
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let started_at = Instant::now();
    while started_at.elapsed() < Duration::from_secs(MAX_WAIT_SECONDS) {
        let status_response = client
            .get(format!("{base_url}/transcript/{}", transcript.id))
            .header("authorization", api_key.clone())
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !status_response.status().is_success() {
            let error_text = status_response.text().await.unwrap_or_default();
            return Err(format!("AssemblyAI polling failed: {}", error_text));
        }

        let status: AssemblyAITranscriptStatus =
            status_response.json().await.map_err(|e| e.to_string())?;

        match status.status.as_str() {
            "completed" => {
                let text = status.text.unwrap_or_default();
                if text.trim().is_empty() {
                    return Err("AssemblyAI returned no transcription text".to_string());
                }
                return Ok(text);
            }
            "error" => {
                return Err(status
                    .error
                    .unwrap_or_else(|| "AssemblyAI transcription failed".to_string()))
            }
            _ => sleep(Duration::from_millis(POLL_INTERVAL_MS)).await,
        }
    }

    Err("AssemblyAI transcription timed out".to_string())
}

#[cfg(test)]
mod tests {
    use crate::transcription::providers::{provider_batch_url, BatchProvider};

    use super::{
        assemblyai_base_url, assemblyai_prompt_for_model, build_assemblyai_speech_models,
        normalize_assemblyai_model,
    };

    #[test]
    fn normalizes_assemblyai_models_and_prompt_support() {
        assert_eq!(normalize_assemblyai_model(None), "universal-3-pro");
        assert_eq!(
            normalize_assemblyai_model(Some("universal-2".to_string())),
            "universal-2"
        );
        assert_eq!(
            build_assemblyai_speech_models("universal-3-pro"),
            vec!["universal-3-pro".to_string(), "universal-2".to_string()]
        );
        assert_eq!(
            build_assemblyai_speech_models("universal-2"),
            vec!["universal-2".to_string()]
        );
        assert_eq!(
            assemblyai_prompt_for_model("universal-3-pro", Some("terms".to_string())),
            Some("terms".to_string())
        );
        assert_eq!(
            assemblyai_prompt_for_model("universal-2", Some("terms".to_string())),
            None
        );
    }

    #[test]
    fn resolves_assemblyai_base_url() {
        assert_eq!(
            assemblyai_base_url(None),
            provider_batch_url(BatchProvider::AssemblyAI, None)
        );
        assert_eq!(
            assemblyai_base_url(Some("https://assembly-proxy.example.test/v2".to_string())),
            "https://assembly-proxy.example.test/v2"
        );
    }
}
