use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::time::{sleep, timeout, Duration, Instant};

#[cfg(target_os = "macos")]
use std::path::PathBuf;

#[cfg(target_os = "macos")]
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionProvider {
    pub id: String,
    pub name: String,
    pub requires_key: bool,
}

/// Get available transcription providers
#[tauri::command]
pub fn get_transcription_providers() -> Vec<TranscriptionProvider> {
    vec![
        TranscriptionProvider {
            id: "assemblyai".to_string(),
            name: "AssemblyAI".to_string(),
            requires_key: true,
        },
        TranscriptionProvider {
            id: "openai".to_string(),
            name: "OpenAI Whisper".to_string(),
            requires_key: true,
        },
        TranscriptionProvider {
            id: "groq".to_string(),
            name: "Groq".to_string(),
            requires_key: true,
        },
        TranscriptionProvider {
            id: "zai".to_string(),
            name: "Z.ai (Zhipu GLM ASR)".to_string(),
            requires_key: true,
        },
    ]
}

/// Transcribe audio using cloud provider
#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    audio_data: Vec<u8>,
    provider: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let transcription_prompt = super::settings::get_setting(
        app.clone(),
        "transcriptionPrompt".to_string(),
    )?
    .and_then(|v| v.as_str().map(|s| s.trim().to_string()))
    .filter(|s| !s.is_empty());

    // Get API key from settings
    let key_name = match provider.as_str() {
        "assemblyai" => "ASSEMBLYAI_API_KEY",
        "openai" => "OPENAI_API_KEY",
        "groq" => "GROQ_API_KEY",
        "zai" => "ZAI_API_KEY",
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let api_key = super::settings::get_env_var(app.clone(), key_name.to_string())?
        .ok_or_else(|| format!("{} not found. Please set your API key.", key_name))?;

    timeout(Duration::from_secs(60), async move {
        match provider.as_str() {
            "assemblyai" => {
                transcribe_assemblyai(audio_data, api_key, model, language, transcription_prompt)
                    .await
            }
            "openai" => transcribe_openai(audio_data, api_key, model, language).await,
            "groq" => transcribe_groq(audio_data, api_key, model, language).await,
            "zai" => transcribe_zai(audio_data, api_key, model, language).await,
            _ => Err(format!("Unknown provider: {}", provider)),
        }
    })
    .await
    .map_err(|_| "Transcription timed out after 60 seconds".to_string())?
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

async fn transcribe_assemblyai(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
    prompt: Option<String>,
) -> Result<String, String> {
    const POLL_INTERVAL_MS: u64 = 1_000;
    const MAX_WAIT_SECONDS: u64 = 180;

    let client = reqwest::Client::new();
    let model = normalize_assemblyai_model(model);
    let speech_models = build_assemblyai_speech_models(&model);
    let prompt = if model == "universal-3-pro" {
        prompt
    } else {
        None
    };
    let preferred_language = language.unwrap_or_else(|| "auto".to_string());

    eprintln!(
        "[assemblyai] submitting transcript model={} speech_models={:?} preferred_language={} language_detection=true includes_prompt={}",
        model,
        speech_models,
        preferred_language,
        prompt.is_some()
    );

    let upload_response = client
        .post("https://api.assemblyai.com/v2/upload")
        .header("authorization", api_key.clone())
        .header("content-type", "application/octet-stream")
        .body(audio_data)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !upload_response.status().is_success() {
        let error_text = upload_response.text().await.unwrap_or_default();
        eprintln!(
            "[assemblyai] upload failed status_text={}",
            error_text
        );
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
        .post("https://api.assemblyai.com/v2/transcript")
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
        return Err(format!("AssemblyAI transcript submission failed: {}", error_text));
    }

    let transcript: AssemblyAITranscriptResponse =
        transcript_response.json().await.map_err(|e| e.to_string())?;

    let started_at = Instant::now();
    while started_at.elapsed() < Duration::from_secs(MAX_WAIT_SECONDS) {
        let status_response = client
            .get(format!(
                "https://api.assemblyai.com/v2/transcript/{}",
                transcript.id
            ))
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
                return Err(
                    status
                        .error
                        .unwrap_or_else(|| "AssemblyAI transcription failed".to_string()),
                )
            }
            _ => sleep(Duration::from_millis(POLL_INTERVAL_MS)).await,
        }
    }

    Err("AssemblyAI transcription timed out".to_string())
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
    // MP4/QuickTime: ... ftyp ....
    if audio_data.len() >= 12 && &audio_data[4..8] == b"ftyp" {
        return "m4a";
    }
    // WebM/Matroska EBML header.
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

async fn transcribe_openai(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = model.unwrap_or_else(|| "whisper-1".to_string());

    // Create multipart form
    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name("audio.webm")
        .mime_str("audio/webm")
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
        .post("https://api.openai.com/v1/audio/transcriptions")
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

async fn transcribe_groq(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = model.unwrap_or_else(|| "whisper-large-v3-turbo".to_string());

    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name("audio.webm")
        .mime_str("audio/webm")
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
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
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

async fn transcribe_zai(
    audio_data: Vec<u8>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = model.unwrap_or_else(|| "glm-asr-2512".to_string());

    // Z.ai requires WAV/MP3; on macOS we convert using the built-in `afconvert`.
    #[cfg(target_os = "macos")]
    let audio_data = {
        // Our native macOS recorder already produces 16kHz mono WAV.
        // Avoid `afconvert` when the input is already WAV to reduce flakiness.
        if guess_audio_extension(&audio_data) == "wav" {
            audio_data
        } else {
            convert_to_wav_macos(&audio_data).await?
        }
    };

    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model);

    // Keep parity with the renderer implementation: Z.ai's endpoint is picky about accepted fields.
    // We intentionally do NOT send `language` for Z.ai.
    let _ = language;

    let response = client
        .post("https://api.z.ai/api/paas/v4/audio/transcriptions")
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
    let candidate = result
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
        .or_else(|| result.get("transcription").and_then(|v| v.as_str()));

    match candidate {
        Some(text) if !text.trim().is_empty() => Ok(text.to_string()),
        _ => Err("Z.ai returned no transcription text".to_string()),
    }
}
