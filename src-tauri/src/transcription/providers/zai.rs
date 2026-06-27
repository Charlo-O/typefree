use crate::commands::command_error::CommandResult;

use super::super::domain::{
    detect_audio_part_metadata, AudioPartMetadata, BatchTranscriptionRequest,
    BatchTranscriptionResult, TranscriptionProvider,
};
use super::{provider_batch_url, BatchProvider};

#[cfg(target_os = "macos")]
use std::path::PathBuf;

#[cfg(target_os = "macos")]
use tokio::process::Command;

pub(super) struct ZaiProvider;

impl TranscriptionProvider for ZaiProvider {
    fn id(&self) -> &'static str {
        "zai"
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
        let text = transcribe_zai(audio_data, api_key, model, language, endpoint_override).await?;
        Ok(BatchTranscriptionResult::new(self.id(), text))
    }
}

#[cfg(target_os = "macos")]
fn guess_audio_extension(audio_data: &[u8]) -> &'static str {
    if audio_data.len() >= 12 && &audio_data[0..4] == b"RIFF" && &audio_data[8..12] == b"WAVE" {
        return "wav";
    }
    if audio_data.len() >= 4 && &audio_data[0..4] == b"OggS" {
        return "ogg";
    }
    if audio_data.len() >= 3 && &audio_data[0..3] == b"ID3" {
        return "mp3";
    }
    if audio_data.len() >= 12 && &audio_data[4..8] == b"ftyp" {
        return "m4a";
    }
    if audio_data.len() >= 4 && audio_data[0..4] == [0x1A, 0x45, 0xDF, 0xA3] {
        return "webm";
    }
    "bin"
}

#[cfg(target_os = "macos")]
fn unique_temp_file(prefix: &str, ext: &str) -> PathBuf {
    let now_ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    std::env::temp_dir().join(format!("typefree-{prefix}-{pid}-{now_ns}.{ext}"))
}

#[cfg(target_os = "macos")]
async fn convert_to_wav_macos(input: &[u8]) -> Result<Vec<u8>, String> {
    let input_ext = guess_audio_extension(input);
    let input_path = unique_temp_file("in", input_ext);
    let output_path = unique_temp_file("out", "wav");

    tokio::fs::write(&input_path, input)
        .await
        .map_err(|e| format!("Failed to write temp audio file: {e}"))?;

    let output = Command::new("/usr/bin/afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", "--mix"])
        .arg(&input_path)
        .arg(&output_path)
        .output()
        .await
        .map_err(|e| format!("Failed to run afconvert: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = tokio::fs::remove_file(&input_path).await;
        let _ = tokio::fs::remove_file(&output_path).await;
        return Err(format!("afconvert failed: {}", stderr.trim()));
    }

    let wav_data = tokio::fs::read(&output_path)
        .await
        .map_err(|e| format!("Failed to read converted WAV: {e}"))?;

    let _ = tokio::fs::remove_file(&input_path).await;
    let _ = tokio::fs::remove_file(&output_path).await;

    Ok(wav_data)
}

async fn transcribe_zai(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
    endpoint_override: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = normalize_zai_model(model);
    let endpoint = zai_transcription_endpoint(endpoint_override);
    let audio_data = prepare_zai_audio(audio_data).await?;
    let metadata = zai_audio_part_metadata(&audio_data)?;

    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name(format!("audio.{}", metadata.extension))
        .mime_str(metadata.mime_type)
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model);

    let _ = language;

    let response = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Z.ai API error: {}", error_text));
    }

    let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    match extract_zai_transcript_text(&result) {
        Some(text) if !text.trim().is_empty() => Ok(text.to_string()),
        _ => Err("Z.ai returned no transcription text".to_string()),
    }
}

async fn prepare_zai_audio(audio_data: Vec<u8>) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        if guess_audio_extension(&audio_data) == "wav" {
            return Ok(audio_data);
        }
        return convert_to_wav_macos(&audio_data).await;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(audio_data)
    }
}

fn normalize_zai_model(model: Option<String>) -> String {
    match model.as_deref().map(str::trim) {
        Some(model) if model.starts_with("glm-asr") => model.to_string(),
        _ => "glm-asr-2512".to_string(),
    }
}

fn zai_transcription_endpoint(endpoint_override: Option<String>) -> String {
    provider_batch_url(BatchProvider::Zai, endpoint_override)
}

fn zai_audio_part_metadata(audio_data: &[u8]) -> Result<AudioPartMetadata, String> {
    let metadata = detect_audio_part_metadata(audio_data, "webm");
    match metadata.extension {
        "wav" | "mp3" => Ok(metadata),
        _ => Err(
            "Z.ai batch transcription requires WAV or MP3 audio after renderer preparation"
                .to_string(),
        ),
    }
}

fn extract_zai_transcript_text(result: &serde_json::Value) -> Option<&str> {
    result
        .get("text")
        .and_then(|v| v.as_str())
        .or_else(|| result.pointer("/data/text").and_then(|v| v.as_str()))
        .or_else(|| result.pointer("/data/result/text").and_then(|v| v.as_str()))
        .or_else(|| result.pointer("/result/text").and_then(|v| v.as_str()))
        .or_else(|| {
            result
                .pointer("/data/transcription")
                .and_then(|v| v.as_str())
        })
        .or_else(|| result.get("transcription").and_then(|v| v.as_str()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::transcription::providers::{provider_batch_url, BatchProvider};

    use super::{
        extract_zai_transcript_text, normalize_zai_model, zai_audio_part_metadata,
        zai_transcription_endpoint,
    };

    #[test]
    fn normalizes_zai_batch_model_defaults() {
        assert_eq!(normalize_zai_model(None), "glm-asr-2512");
        assert_eq!(normalize_zai_model(Some("".to_string())), "glm-asr-2512");
        assert_eq!(
            normalize_zai_model(Some("whisper-1".to_string())),
            "glm-asr-2512"
        );
        assert_eq!(
            normalize_zai_model(Some(" glm-asr-2512 ".to_string())),
            "glm-asr-2512"
        );
    }

    #[test]
    fn resolves_zai_transcription_endpoint() {
        assert_eq!(
            zai_transcription_endpoint(None),
            provider_batch_url(BatchProvider::Zai, None)
        );
        assert_eq!(
            zai_transcription_endpoint(Some(
                "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions".to_string()
            )),
            "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions"
        );
    }

    #[test]
    fn validates_zai_audio_upload_metadata() {
        let wav = zai_audio_part_metadata(b"RIFF\x24\x00\x00\x00WAVEfmt ").unwrap();
        assert_eq!(wav.extension, "wav");
        assert_eq!(wav.mime_type, "audio/wav");

        let mp3 = zai_audio_part_metadata(b"ID3\x04\x00\x00").unwrap();
        assert_eq!(mp3.extension, "mp3");
        assert_eq!(mp3.mime_type, "audio/mpeg");

        let error = zai_audio_part_metadata(&[0x1a, 0x45, 0xdf, 0xa3])
            .expect_err("webm should be rejected for Z.ai batch upload");
        assert!(error.contains("requires WAV or MP3"));
    }

    #[test]
    fn extracts_zai_transcript_text_variants() {
        let cases = [
            (json!({ "text": "root" }), "root"),
            (json!({ "data": { "text": "data" } }), "data"),
            (
                json!({ "data": { "result": { "text": "result" } } }),
                "result",
            ),
            (
                json!({ "result": { "text": "nested-result" } }),
                "nested-result",
            ),
            (
                json!({ "data": { "transcription": "data-transcription" } }),
                "data-transcription",
            ),
            (json!({ "transcription": "transcription" }), "transcription"),
        ];

        for (payload, expected) in cases {
            assert_eq!(extract_zai_transcript_text(&payload), Some(expected));
        }

        assert_eq!(
            extract_zai_transcript_text(&json!({ "text": "" })),
            Some("")
        );
        assert_eq!(extract_zai_transcript_text(&json!({ "data": {} })), None);
    }
}
