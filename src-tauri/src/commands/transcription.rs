use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::command_error::CommandResult;
use crate::transcription::providers::batch_provider_catalog;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionProviderCapabilities {
    pub supports_batch: bool,
    pub supports_streaming: bool,
    pub supports_realtime: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionProvider {
    pub id: String,
    pub name: String,
    pub requires_key: bool,
    pub default_base_url: String,
    pub supports_endpoint_override: bool,
    pub capabilities: TranscriptionProviderCapabilities,
}

/// Get available transcription providers
#[tauri::command]
pub fn get_transcription_providers() -> Vec<TranscriptionProvider> {
    batch_provider_catalog()
        .iter()
        .map(|provider| TranscriptionProvider {
            id: provider.id.to_string(),
            name: provider.name.to_string(),
            requires_key: provider.requires_key,
            default_base_url: provider.default_base_url.to_string(),
            supports_endpoint_override: provider.supports_endpoint_override,
            capabilities: TranscriptionProviderCapabilities {
                supports_batch: provider.capabilities.supports_batch,
                supports_streaming: provider.capabilities.supports_streaming,
                supports_realtime: provider.capabilities.supports_realtime,
            },
        })
        .collect()
}

/// Transcribe audio using cloud provider
#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    audio_data: Vec<u8>,
    provider: String,
    model: Option<String>,
    language: Option<String>,
    session_id: Option<String>,
    endpoint_override: Option<String>,
) -> CommandResult<String> {
    crate::transcription::batch_service::transcribe_audio(
        app,
        audio_data,
        provider,
        model,
        language,
        session_id,
        endpoint_override,
    )
    .await
}
