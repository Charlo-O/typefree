use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout, Duration, Instant};

#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::sync::OnceLock;

#[cfg(target_os = "macos")]
use tokio::process::Command;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::{Read as IoRead, Write as IoWrite};

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
        TranscriptionProvider {
            id: "volcengine".to_string(),
            name: "Volcengine (豆包)".to_string(),
            requires_key: true,
        },
    ]
}

enum VolcengineStreamCommand {
    Audio(Vec<u8>),
    Finish,
    Cancel,
}

struct VolcengineStreamingSession {
    tx: mpsc::Sender<VolcengineStreamCommand>,
    handle: JoinHandle<Result<String, String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VolcengineStreamingTranscriptEvent {
    session_id: String,
    text: String,
    is_final: bool,
    audio_ms: Option<u64>,
    definite: bool,
}

static VOLCENGINE_STREAMING_SESSIONS: OnceLock<Mutex<HashMap<String, VolcengineStreamingSession>>> =
    OnceLock::new();

fn volcengine_streaming_sessions() -> &'static Mutex<HashMap<String, VolcengineStreamingSession>> {
    VOLCENGINE_STREAMING_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Start a low-latency Volcengine/Doubao streaming session.
///
/// The command returns as soon as the background task is spawned. Audio chunks
/// sent during the WebSocket handshake are buffered by the channel, so the UI
/// can start recording immediately instead of waiting for the network.
#[tauri::command]
pub async fn start_volcengine_streaming_transcription(
    app: AppHandle,
    app_id: String,
    access_token: String,
    resource_id: Option<String>,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let access_token = access_token.trim().to_string();
    let app_id = app_id.trim().to_string();
    if access_token.is_empty() {
        return Err("Volcengine API Key or Access Token is required".to_string());
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel::<VolcengineStreamCommand>(512);
    let resource_id = resource_id.unwrap_or_else(|| "volc.seedasr.sauc.duration".to_string());

    let handle = tokio::spawn(run_volcengine_streaming_session(
        app,
        rx,
        app_id,
        access_token,
        resource_id,
        model,
        language,
        session_id.clone(),
    ));

    volcengine_streaming_sessions().lock().await.insert(
        session_id.clone(),
        VolcengineStreamingSession { tx, handle },
    );

    Ok(session_id)
}

#[tauri::command]
pub async fn send_volcengine_streaming_audio(
    session_id: String,
    audio_data: Vec<u8>,
) -> Result<(), String> {
    if audio_data.is_empty() {
        return Ok(());
    }

    let tx = {
        let sessions = volcengine_streaming_sessions().lock().await;
        sessions
            .get(&session_id)
            .map(|session| session.tx.clone())
            .ok_or_else(|| "Volcengine streaming session not found".to_string())?
    };

    match tx.send(VolcengineStreamCommand::Audio(audio_data)).await {
        Ok(()) => Ok(()),
        Err(_) => {
            let session = {
                let mut sessions = volcengine_streaming_sessions().lock().await;
                sessions.remove(&session_id)
            };

            let Some(session) = session else {
                return Err("Volcengine streaming session is closed".to_string());
            };

            match session.handle.await {
                Ok(Ok(_)) => {
                    Err("Volcengine streaming session finished before audio upload".to_string())
                }
                Ok(Err(err)) => Err(err),
                Err(err) => Err(format!("Volcengine streaming task failed: {err}")),
            }
        }
    }
}

#[tauri::command]
pub async fn finish_volcengine_streaming_transcription(
    session_id: String,
) -> Result<String, String> {
    let session = {
        let mut sessions = volcengine_streaming_sessions().lock().await;
        sessions
            .remove(&session_id)
            .ok_or_else(|| "Volcengine streaming session not found".to_string())?
    };

    let _ = session.tx.send(VolcengineStreamCommand::Finish).await;

    let mut handle = session.handle;
    tokio::select! {
        join_result = &mut handle => {
            join_result
                .map_err(|e| format!("Volcengine streaming task failed: {e}"))?
        }
        _ = sleep(Duration::from_secs(20)) => {
            handle.abort();
            Err("Volcengine streaming transcription timed out after finish".to_string())
        }
    }
}

#[tauri::command]
pub async fn cancel_volcengine_streaming_transcription(session_id: String) -> Result<(), String> {
    let session = {
        let mut sessions = volcengine_streaming_sessions().lock().await;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        let _ = session.tx.send(VolcengineStreamCommand::Cancel).await;
        session.handle.abort();
    }

    Ok(())
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
    let transcription_prompt =
        super::settings::get_setting(app.clone(), "transcriptionPrompt".to_string())?
            .and_then(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty());

    // Volcengine uses APP ID and Access Token from settings. The API still
    // expects X-Api-Resource-Id on the wire, but TypeFree keeps that internal.
    if provider == "volcengine" {
        let app_id = super::settings::get_env_var(app.clone(), "VOLCENGINE_APP_ID".to_string())?
            .unwrap_or_default();
        let access_token = super::settings::get_env_var(
            app.clone(),
            "VOLCENGINE_ACCESS_TOKEN".to_string(),
        )?
        .ok_or_else(|| {
            "VOLCENGINE_ACCESS_TOKEN not found. Please set your Volcengine API Key or Access Token."
                .to_string()
        })?;
        let resource_id = "volc.seedasr.sauc.duration".to_string();
        let hotwords = super::vocabulary::load_effective_hotwords(&app);

        return timeout(Duration::from_secs(60), async move {
            transcribe_volcengine(
                audio_data,
                app_id,
                access_token,
                resource_id,
                model,
                language,
                hotwords,
            )
            .await
        })
        .await
        .map_err(|_| "Volcengine transcription timed out after 60 seconds".to_string())?;
    }

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
                return Err(status
                    .error
                    .unwrap_or_else(|| "AssemblyAI transcription failed".to_string()))
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

// ============================================================================
// Volcengine (豆包) streaming ASR via WebSocket binary protocol
// ============================================================================

// Volcengine binary protocol constants
const VOLC_PROTOCOL_VERSION: u8 = 0x01;
const VOLC_HEADER_SIZE: u8 = 0x01; // 1 * 4 bytes
const VOLC_MSG_FULL_CLIENT_REQUEST: u8 = 0x01;
const VOLC_MSG_AUDIO_ONLY: u8 = 0x02;
const VOLC_MSG_FULL_SERVER_RESPONSE: u8 = 0x09;
const VOLC_MSG_SERVER_ACK: u8 = 0x0b;
const VOLC_MSG_SERVER_ERROR: u8 = 0x0f;
const VOLC_FLAGS_NONE: u8 = 0x00;
const VOLC_FLAGS_LAST_AUDIO: u8 = 0x02;
const VOLC_FLAGS_NEGATIVE_SEQUENCE_LAST: u8 = 0x03;
const VOLC_FLAGS_ASYNC_FINAL_RESPONSE: u8 = 0x04;
const VOLC_SERIAL_JSON: u8 = 0x01;
const VOLC_COMPRESS_GZIP: u8 = 0x01;

fn volc_build_header(msg_type: u8, flags: u8, serialization: u8, compression: u8) -> [u8; 4] {
    [
        (VOLC_PROTOCOL_VERSION << 4) | VOLC_HEADER_SIZE,
        (msg_type << 4) | flags,
        (serialization << 4) | compression,
        0x00,
    ]
}

fn gzip_compress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(data)
        .map_err(|e| format!("gzip compress: {e}"))?;
    encoder.finish().map_err(|e| format!("gzip finish: {e}"))
}

fn gzip_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(data);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|e| format!("gzip decompress: {e}"))?;
    Ok(out)
}

async fn transcribe_volcengine(
    audio_data: Vec<u8>,
    app_id: String,
    access_token: String,
    resource_id: String,
    model: Option<String>,
    language: Option<String>,
    hotwords: Vec<String>,
) -> Result<String, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::{self, Message};

    let audio_data = normalize_volcengine_audio(audio_data)?;
    let expected_audio_duration_ms = volcengine_pcm_duration_ms(&audio_data);
    let resource_id = normalize_volcengine_resource_id(&resource_id);
    let mode = VolcengineMode::from_model(model.as_deref());
    let ws_url = mode.endpoint();
    let connect_id = uuid::Uuid::new_v4().to_string();

    eprintln!(
        "[volcengine] connecting to {} mode={} resource={} audio_ms={} connect_id={}",
        ws_url,
        mode.label(),
        resource_id,
        expected_audio_duration_ms,
        connect_id
    );

    // Build HTTP request with custom headers (required by Volcengine)
    let uri: http::Uri = ws_url
        .parse()
        .map_err(|e: http::uri::InvalidUri| e.to_string())?;
    let host = uri.host().unwrap_or("openspeech.bytedance.com");

    let mut connected = None;
    let mut last_connect_error = None;
    for auth_mode in volcengine_auth_modes(&app_id) {
        let request_builder = http::Request::builder()
            .uri(ws_url)
            .header("Host", host)
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header(
                "Sec-WebSocket-Key",
                tungstenite::handshake::client::generate_key(),
            )
            .header("X-Api-Resource-Id", &resource_id)
            .header("X-Api-Connect-Id", &connect_id);

        let request =
            with_volcengine_auth_headers(request_builder, &app_id, &access_token, auth_mode)
                .body(())
                .map_err(|e| format!("Failed to build WS request: {e}"))?;

        match tokio_tungstenite::connect_async(request).await {
            Ok(result) => {
                connected = Some((auth_mode, result));
                break;
            }
            Err(err) => {
                let message = format!("Failed to connect to Volcengine ASR: {err}");
                eprintln!(
                    "[volcengine] connect failed auth_mode={} error={}",
                    auth_mode.label(),
                    message
                );
                if should_retry_volcengine_auth(&message, auth_mode) {
                    last_connect_error = Some(message);
                    continue;
                }
                return Err(message);
            }
        }
    }

    let (auth_mode, (ws_stream, response)) = connected.ok_or_else(|| {
        last_connect_error.unwrap_or_else(|| "Volcengine ASR connect failed".to_string())
    })?;

    let log_id = response
        .headers()
        .get("X-Tt-Logid")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    eprintln!(
        "[volcengine] connected auth_mode={} connect_id={} log_id={}",
        auth_mode.label(),
        connect_id,
        log_id
    );

    let (mut write, mut read) = ws_stream.split();

    // 1. Send config packet
    let lang = match language.as_deref() {
        Some("auto") | None => "zh-CN",
        Some(l) => l,
    };
    let mut audio_payload = serde_json::json!({
        "format": "pcm",
        "codec": "raw",
        "rate": 16000,
        "bits": 16,
        "channel": 1,
    });
    if mode.supports_language() {
        audio_payload["language"] = serde_json::Value::String(lang.to_string());
    }

    let payload_app_id = if app_id.trim().is_empty() {
        "typefree"
    } else {
        app_id.as_str()
    };

    let mut config_payload = serde_json::json!({
        "app": { "appid": payload_app_id, "cluster": resource_id, "token": access_token },
        "user": { "uid": "typefree-user" },
        "request": {
            "reqid": uuid::Uuid::new_v4().to_string(),
            "nbest": 1,
            "workflow": "audio_in,resample,partition,vad,fe,decode",
            "sequence": 1,
            "show_utterances": true,
            "result_type": "full",
            "enable_itn": true,
            "enable_punc": true,
        },
        "audio": audio_payload,
    });
    if !hotwords.is_empty() {
        config_payload["context"] = serde_json::json!({
            "hotwords": hotwords
                .iter()
                .map(|word| serde_json::json!({ "word": word, "scale": 5.0 }))
                .collect::<Vec<_>>()
        });
    }

    eprintln!(
        "[volcengine] config prepared auth_mode={} mode={} resource={} audio_ms={} hotwords={}",
        auth_mode.label(),
        mode.label(),
        resource_id,
        expected_audio_duration_ms,
        hotwords.len()
    );

    let json_bytes = serde_json::to_vec(&config_payload).map_err(|e| e.to_string())?;
    let compressed = gzip_compress(&json_bytes)?;

    let header = volc_build_header(
        VOLC_MSG_FULL_CLIENT_REQUEST,
        VOLC_FLAGS_NONE,
        VOLC_SERIAL_JSON,
        VOLC_COMPRESS_GZIP,
    );
    let mut packet = Vec::with_capacity(4 + 4 + compressed.len());
    packet.extend_from_slice(&header);
    packet.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
    packet.extend_from_slice(&compressed);

    write
        .send(Message::Binary(packet.into()))
        .await
        .map_err(|e| format!("WS send config: {e}"))?;

    // 2. Send audio in 200ms chunks. The official API recommends 100-200ms packets
    // and 100-200ms send intervals; 200ms packets are recommended for bidirectional mode.
    // TypeFree sends recorded audio after key-up, so we use the lowest documented interval.
    let chunk_size = 6400usize;
    let chunk_interval_ms = 100u64;
    let total_chunks = (audio_data.len() + chunk_size - 1) / chunk_size;

    for i in 0..total_chunks {
        let start = i * chunk_size;
        let end = std::cmp::min(start + chunk_size, audio_data.len());
        let chunk = &audio_data[start..end];
        let is_last = i == total_chunks - 1;

        let audio_header = volc_build_header(
            VOLC_MSG_AUDIO_ONLY,
            if is_last {
                VOLC_FLAGS_LAST_AUDIO
            } else {
                VOLC_FLAGS_NONE
            },
            0x00,
            0x00,
        );
        let mut audio_packet = Vec::with_capacity(4 + 4 + chunk.len());
        audio_packet.extend_from_slice(&audio_header);
        audio_packet.extend_from_slice(&(chunk.len() as u32).to_be_bytes());
        audio_packet.extend_from_slice(chunk);

        write
            .send(Message::Binary(audio_packet.into()))
            .await
            .map_err(|e| format!("WS send audio: {e}"))?;

        if !is_last {
            sleep(Duration::from_millis(chunk_interval_ms)).await;
        }
    }

    eprintln!(
        "[volcengine] sent {} audio chunks ({} bytes, {}ms interval)",
        total_chunks,
        audio_data.len(),
        chunk_interval_ms
    );

    // 3. Read responses until connection closes
    let mut accumulated_text = String::new();

    while let Some(msg) = read.next().await {
        let msg = msg.map_err(|e| format!("WS read: {e}"))?;
        let data = match msg {
            Message::Binary(b) => b.to_vec(),
            Message::Close(_) => break,
            _ => continue,
        };

        if data.len() < 4 {
            continue;
        }

        let msg_type = (data[1] >> 4) & 0x0f;
        let msg_flags = data[1] & 0x0f;
        let compression = data[2] & 0x0f;
        let header_byte_len = (data[0] & 0x0f) as usize * 4;

        if msg_type == VOLC_MSG_SERVER_ACK {
            continue;
        }

        if msg_type == VOLC_MSG_SERVER_ERROR {
            // Dump raw bytes for debugging
            let hex: Vec<String> = data
                .iter()
                .take(128)
                .map(|b| format!("{:02x}", b))
                .collect();
            eprintln!(
                "[volcengine] error packet raw ({} bytes): {}",
                data.len(),
                hex.join(" ")
            );

            // Error packet format per spec: Header(4) + ErrorCode(4) + MessageSize(4) + UTF-8 string
            let mut error_msg = "Volcengine ASR server error".to_string();
            let h = header_byte_len; // typically 4

            if data.len() >= h + 8 {
                let code = u32::from_be_bytes(data[h..h + 4].try_into().unwrap_or([0; 4]));
                let msg_size =
                    u32::from_be_bytes(data[h + 4..h + 8].try_into().unwrap_or([0; 4])) as usize;
                eprintln!("[volcengine] error code={}, msg_size={}", code, msg_size);

                if msg_size > 0 && data.len() >= h + 8 + msg_size {
                    let raw = &data[h + 8..h + 8 + msg_size];
                    error_msg = String::from_utf8_lossy(raw).to_string();
                } else if data.len() > h + 8 {
                    // Try reading rest of packet as UTF-8
                    let raw = &data[h + 8..];
                    error_msg = String::from_utf8_lossy(raw).to_string();
                }
                error_msg = format!("Volcengine error {}: {}", code, error_msg);
            } else if data.len() > h {
                // Fallback: try entire payload after header as UTF-8
                error_msg = String::from_utf8_lossy(&data[h..]).to_string();
            }

            eprintln!("[volcengine] server error: {}", error_msg);
            return Err(error_msg);
        }

        if msg_type != VOLC_MSG_FULL_SERVER_RESPONSE {
            continue;
        }

        let Some(raw_payload) = volcengine_response_payload(&data, header_byte_len) else {
            continue;
        };
        let payload_bytes = if compression == VOLC_COMPRESS_GZIP {
            gzip_decompress(&raw_payload).unwrap_or(raw_payload)
        } else {
            raw_payload
        };

        if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&payload_bytes) {
            eprintln!(
                "[volcengine] response payload: {}",
                serde_json::to_string(&parsed).unwrap_or_default()
            );

            let text = volcengine_response_text(&parsed).unwrap_or("");

            if !text.is_empty() {
                accumulated_text = text.to_string();
                let response_audio_ms = parsed
                    .pointer("/audio_info/duration")
                    .and_then(|value| value.as_u64())
                    .unwrap_or_default();

                let is_final_result = msg_flags == VOLC_FLAGS_ASYNC_FINAL_RESPONSE
                    || msg_flags == VOLC_FLAGS_NEGATIVE_SEQUENCE_LAST
                    || volcengine_response_is_definite(&parsed);

                // Once the server reports a final result covering the uploaded audio, return
                // without waiting for the close frame. Avoid returning on prefetch/non-definite
                // packets because those can miss tail punctuation or the last unstable words.
                if is_final_result && response_audio_ms + 250 >= expected_audio_duration_ms {
                    eprintln!(
                        "[volcengine] final result ready before close: chars={} response_audio_ms={} expected_audio_ms={}",
                        accumulated_text.len(),
                        response_audio_ms,
                        expected_audio_duration_ms
                    );
                    return Ok(accumulated_text);
                }
            }
        }
    }

    if accumulated_text.is_empty() {
        Err("Volcengine ASR returned no transcription result".to_string())
    } else {
        eprintln!(
            "[volcengine] transcription complete: {} chars",
            accumulated_text.len()
        );
        Ok(accumulated_text)
    }
}

#[derive(Clone, Copy)]
enum VolcengineMode {
    SeedAsr2,
}

impl VolcengineMode {
    fn from_model(_model: Option<&str>) -> Self {
        Self::SeedAsr2
    }

    fn endpoint(self) -> &'static str {
        match self {
            Self::SeedAsr2 => "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::SeedAsr2 => "seed_asr_2",
        }
    }

    fn supports_language(self) -> bool {
        false
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VolcengineAuthMode {
    LegacyAppAccess,
    ApiKey,
}

impl VolcengineAuthMode {
    fn label(self) -> &'static str {
        match self {
            Self::LegacyAppAccess => "legacy-app-access",
            Self::ApiKey => "api-key",
        }
    }
}

fn volcengine_auth_modes(app_id: &str) -> Vec<VolcengineAuthMode> {
    if app_id.trim().is_empty() {
        vec![VolcengineAuthMode::ApiKey]
    } else {
        vec![
            VolcengineAuthMode::LegacyAppAccess,
            VolcengineAuthMode::ApiKey,
        ]
    }
}

fn with_volcengine_auth_headers(
    builder: http::request::Builder,
    app_id: &str,
    access_token: &str,
    mode: VolcengineAuthMode,
) -> http::request::Builder {
    match mode {
        VolcengineAuthMode::LegacyAppAccess => builder
            .header("X-Api-App-Key", app_id)
            .header("X-Api-Access-Key", access_token),
        VolcengineAuthMode::ApiKey => builder.header("X-Api-Key", access_token),
    }
}

fn should_retry_volcengine_auth(error: &str, mode: VolcengineAuthMode) -> bool {
    mode == VolcengineAuthMode::LegacyAppAccess
        && (error.contains("401") || error.to_ascii_lowercase().contains("unauthorized"))
}

fn normalize_volcengine_resource_id(resource_id: &str) -> String {
    let trimmed = resource_id.trim();
    if trimmed.starts_with("volc.") {
        return trimmed.to_string();
    }

    let lower = trimmed.to_ascii_lowercase();
    let fallback = if trimmed.is_empty()
        || lower.contains("seed")
        || lower.contains("2.0")
        || lower.contains("seedasr")
    {
        "volc.seedasr.sauc.duration"
    } else {
        "volc.bigasr.sauc.duration"
    };

    if trimmed.is_empty() {
        eprintln!("[volcengine] resource_id empty, using {}", fallback);
    } else {
        eprintln!(
            "[volcengine] resource_id '{}' is not an API Resource ID, using {}",
            trimmed, fallback
        );
    }

    fallback.to_string()
}

fn normalize_volcengine_audio(audio_data: Vec<u8>) -> Result<Vec<u8>, String> {
    if audio_data.len() < 12 || &audio_data[0..4] != b"RIFF" || &audio_data[8..12] != b"WAVE" {
        return Ok(audio_data);
    }

    let mut offset = 12usize;
    let mut format: Option<u16> = None;
    let mut channels: Option<u16> = None;
    let mut sample_rate: Option<u32> = None;
    let mut bits_per_sample: Option<u16> = None;

    while offset + 8 <= audio_data.len() {
        let chunk_id = &audio_data[offset..offset + 4];
        let chunk_size = u32::from_le_bytes(
            audio_data[offset + 4..offset + 8]
                .try_into()
                .map_err(|_| "Invalid WAV chunk size".to_string())?,
        ) as usize;
        let chunk_start = offset + 8;
        let chunk_end = chunk_start.saturating_add(chunk_size);

        if chunk_end > audio_data.len() {
            return Err("Invalid WAV chunk length".to_string());
        }

        match chunk_id {
            b"fmt " if chunk_size >= 16 => {
                format = Some(u16::from_le_bytes(
                    audio_data[chunk_start..chunk_start + 2]
                        .try_into()
                        .map_err(|_| "Invalid WAV format".to_string())?,
                ));
                channels = Some(u16::from_le_bytes(
                    audio_data[chunk_start + 2..chunk_start + 4]
                        .try_into()
                        .map_err(|_| "Invalid WAV channels".to_string())?,
                ));
                sample_rate = Some(u32::from_le_bytes(
                    audio_data[chunk_start + 4..chunk_start + 8]
                        .try_into()
                        .map_err(|_| "Invalid WAV sample rate".to_string())?,
                ));
                bits_per_sample = Some(u16::from_le_bytes(
                    audio_data[chunk_start + 14..chunk_start + 16]
                        .try_into()
                        .map_err(|_| "Invalid WAV bit depth".to_string())?,
                ));
            }
            b"data" => {
                let is_pcm_16k_mono = format == Some(1)
                    && channels == Some(1)
                    && sample_rate == Some(16_000)
                    && bits_per_sample == Some(16);
                if !is_pcm_16k_mono {
                    return Err(format!(
                        "Volcengine expects WAV PCM 16kHz mono 16-bit, got format={:?} channels={:?} sample_rate={:?} bits={:?}",
                        format, channels, sample_rate, bits_per_sample
                    ));
                }
                return Ok(audio_data[chunk_start..chunk_end].to_vec());
            }
            _ => {}
        }

        offset = chunk_end + (chunk_size % 2);
    }

    Err("WAV data chunk not found".to_string())
}

fn volcengine_pcm_duration_ms(audio_data: &[u8]) -> u64 {
    // PCM s16le mono 16kHz: 32 bytes per millisecond.
    (audio_data.len() as u64).saturating_mul(1000) / 32_000
}

fn volcengine_response_payload(data: &[u8], header_len: usize) -> Option<Vec<u8>> {
    // Most server responses are Header + Sequence(4) + PayloadSize(4) + Payload.
    if data.len() >= header_len + 8 {
        let payload_size =
            u32::from_be_bytes(data[header_len + 4..header_len + 8].try_into().ok()?) as usize;
        let payload_start = header_len + 8;
        if payload_size > 0 && data.len() >= payload_start + payload_size {
            return Some(data[payload_start..payload_start + payload_size].to_vec());
        }
    }

    // Be tolerant of Header + PayloadSize(4) + Payload frames.
    if data.len() >= header_len + 4 {
        let payload_size =
            u32::from_be_bytes(data[header_len..header_len + 4].try_into().ok()?) as usize;
        let payload_start = header_len + 4;
        if payload_size > 0 && data.len() >= payload_start + payload_size {
            return Some(data[payload_start..payload_start + payload_size].to_vec());
        }
    }

    None
}

fn volcengine_response_text(parsed: &serde_json::Value) -> Option<&str> {
    parsed
        .get("result")
        .and_then(|result| {
            if let Some(items) = result.as_array() {
                items
                    .first()
                    .and_then(|item| item.get("text"))
                    .and_then(|value| value.as_str())
            } else {
                result.get("text").and_then(|value| value.as_str())
            }
        })
        .or_else(|| parsed.get("text").and_then(|value| value.as_str()))
}

fn volcengine_response_is_definite(parsed: &serde_json::Value) -> bool {
    fn result_is_definite(result: &serde_json::Value) -> bool {
        result
            .get("utterances")
            .and_then(|value| value.as_array())
            .map(|utterances| {
                utterances.iter().any(|utterance| {
                    utterance
                        .get("definite")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    }

    parsed
        .get("result")
        .map(|result| {
            if let Some(items) = result.as_array() {
                items.iter().any(result_is_definite)
            } else {
                result_is_definite(result)
            }
        })
        .unwrap_or(false)
}

async fn run_volcengine_streaming_session(
    app: AppHandle,
    mut rx: mpsc::Receiver<VolcengineStreamCommand>,
    app_id: String,
    access_token: String,
    resource_id: String,
    model: Option<String>,
    language: Option<String>,
    session_id: String,
) -> Result<String, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::{self, Message};

    let resource_id = normalize_volcengine_resource_id(&resource_id);
    let mode = VolcengineMode::from_model(model.as_deref());
    let ws_url = mode.endpoint();
    let connect_id = uuid::Uuid::new_v4().to_string();

    eprintln!(
        "[volcengine-stream] connecting session={} endpoint={} mode={} resource={} connect_id={}",
        session_id,
        ws_url,
        mode.label(),
        resource_id,
        connect_id
    );

    let uri: http::Uri = ws_url
        .parse()
        .map_err(|e: http::uri::InvalidUri| e.to_string())?;
    let host = uri.host().unwrap_or("openspeech.bytedance.com");

    let mut connected = None;
    let mut last_connect_error = None;
    for auth_mode in volcengine_auth_modes(&app_id) {
        let request_builder = http::Request::builder()
            .uri(ws_url)
            .header("Host", host)
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header(
                "Sec-WebSocket-Key",
                tungstenite::handshake::client::generate_key(),
            )
            .header("X-Api-Resource-Id", &resource_id)
            .header("X-Api-Connect-Id", &connect_id);

        let request =
            with_volcengine_auth_headers(request_builder, &app_id, &access_token, auth_mode)
                .body(())
                .map_err(|e| format!("Failed to build Volcengine streaming request: {e}"))?;

        match tokio_tungstenite::connect_async(request).await {
            Ok(result) => {
                connected = Some((auth_mode, result));
                break;
            }
            Err(err) => {
                let message = format!("Failed to connect to Volcengine streaming ASR: {err}");
                eprintln!(
                    "[volcengine-stream] connect failed session={} auth_mode={} error={}",
                    session_id,
                    auth_mode.label(),
                    message
                );
                if should_retry_volcengine_auth(&message, auth_mode) {
                    last_connect_error = Some(message);
                    continue;
                }
                return Err(message);
            }
        }
    }

    let (auth_mode, (ws_stream, response)) = connected.ok_or_else(|| {
        last_connect_error.unwrap_or_else(|| "Volcengine streaming ASR connect failed".to_string())
    })?;

    let log_id = response
        .headers()
        .get("X-Tt-Logid")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    eprintln!(
        "[volcengine-stream] connected session={} auth_mode={} connect_id={} log_id={}",
        session_id,
        auth_mode.label(),
        connect_id,
        log_id
    );

    let (mut write, mut read) = ws_stream.split();

    let lang = match language.as_deref() {
        Some("auto") | None => "zh-CN",
        Some(l) => l,
    };
    let mut audio_payload = serde_json::json!({
        "format": "pcm",
        "codec": "raw",
        "rate": 16000,
        "bits": 16,
        "channel": 1,
    });
    if mode.supports_language() {
        audio_payload["language"] = serde_json::Value::String(lang.to_string());
    }

    let payload_app_id = if app_id.trim().is_empty() {
        "typefree"
    } else {
        app_id.as_str()
    };

    let hotwords = super::vocabulary::load_effective_hotwords(&app);
    let mut config_payload = serde_json::json!({
        "app": { "appid": payload_app_id, "cluster": resource_id, "token": access_token },
        "user": { "uid": "typefree-user" },
        "request": {
            "reqid": uuid::Uuid::new_v4().to_string(),
            "nbest": 1,
            "workflow": "audio_in,resample,partition,vad,fe,decode",
            "sequence": 1,
            "show_utterances": true,
            "result_type": "full",
            "enable_itn": true,
            "enable_punc": true,
        },
        "audio": audio_payload,
    });
    if !hotwords.is_empty() {
        config_payload["context"] = serde_json::json!({
            "hotwords": hotwords
                .iter()
                .map(|word| serde_json::json!({ "word": word, "scale": 5.0 }))
                .collect::<Vec<_>>()
        });
    }

    let json_bytes = serde_json::to_vec(&config_payload).map_err(|e| e.to_string())?;
    let compressed = gzip_compress(&json_bytes)?;
    let header = volc_build_header(
        VOLC_MSG_FULL_CLIENT_REQUEST,
        VOLC_FLAGS_NONE,
        VOLC_SERIAL_JSON,
        VOLC_COMPRESS_GZIP,
    );
    let mut packet = Vec::with_capacity(4 + 4 + compressed.len());
    packet.extend_from_slice(&header);
    packet.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
    packet.extend_from_slice(&compressed);

    write
        .send(Message::Binary(packet.into()))
        .await
        .map_err(|e| format!("Volcengine streaming send config: {e}"))?;

    let mut accumulated_text = String::new();
    let mut total_audio_bytes = 0usize;
    let mut audio_packet_count = 0usize;
    let mut finish_requested = false;
    let mut finish_started_at: Option<Instant> = None;
    let mut command_channel_closed = false;

    loop {
        tokio::select! {
            maybe_command = rx.recv(), if !command_channel_closed => {
                match maybe_command {
                    Some(VolcengineStreamCommand::Audio(data)) => {
                        if finish_requested || data.is_empty() {
                            continue;
                        }
                        let audio_header = volc_build_header(
                            VOLC_MSG_AUDIO_ONLY,
                            VOLC_FLAGS_NONE,
                            0x00,
                            0x00,
                        );
                        let mut audio_packet = Vec::with_capacity(4 + 4 + data.len());
                        audio_packet.extend_from_slice(&audio_header);
                        audio_packet.extend_from_slice(&(data.len() as u32).to_be_bytes());
                        audio_packet.extend_from_slice(&data);

                        write
                            .send(Message::Binary(audio_packet.into()))
                            .await
                            .map_err(|e| format!("Volcengine streaming send audio: {e}"))?;
                        total_audio_bytes += data.len();
                        audio_packet_count += 1;
                    }
                    Some(VolcengineStreamCommand::Finish) => {
                        if !finish_requested {
                            let audio_header = volc_build_header(
                                VOLC_MSG_AUDIO_ONLY,
                                VOLC_FLAGS_LAST_AUDIO,
                                0x00,
                                0x00,
                            );
                            let mut audio_packet = Vec::with_capacity(8);
                            audio_packet.extend_from_slice(&audio_header);
                            audio_packet.extend_from_slice(&0u32.to_be_bytes());
                            write
                                .send(Message::Binary(audio_packet.into()))
                                .await
                                .map_err(|e| format!("Volcengine streaming send finish: {e}"))?;
                            finish_requested = true;
                            finish_started_at = Some(Instant::now());
                            eprintln!(
                                "[volcengine-stream] finish sent session={} chunks={} bytes={}",
                                session_id, audio_packet_count, total_audio_bytes
                            );
                        }
                    }
                    Some(VolcengineStreamCommand::Cancel) => {
                        let _ = write.close().await;
                        return Err("Volcengine streaming transcription cancelled".to_string());
                    }
                    None => {
                        if finish_requested {
                            command_channel_closed = true;
                        } else {
                            let _ = write.close().await;
                            return Err("Volcengine streaming transcription cancelled".to_string());
                        }
                    }
                }
            }
            maybe_message = read.next() => {
                let Some(message) = maybe_message else {
                    break;
                };
                let message = message.map_err(|e| format!("Volcengine streaming read: {e}"))?;
                let data = match message {
                    Message::Binary(b) => b.to_vec(),
                    Message::Close(_) => break,
                    _ => continue,
                };

                if data.len() < 4 {
                    continue;
                }

                let msg_type = (data[1] >> 4) & 0x0f;
                let msg_flags = data[1] & 0x0f;
                let compression = data[2] & 0x0f;
                let header_byte_len = (data[0] & 0x0f) as usize * 4;

                if msg_type == VOLC_MSG_SERVER_ACK {
                    continue;
                }

                if msg_type == VOLC_MSG_SERVER_ERROR {
                    if finish_requested && !accumulated_text.trim().is_empty() {
                        eprintln!(
                            "[volcengine-stream] server closed after finish session={} chars={}",
                            session_id,
                            accumulated_text.len()
                        );
                        return Ok(accumulated_text);
                    }
                    return Err(volcengine_error_packet_to_string(&data, header_byte_len));
                }

                if msg_type != VOLC_MSG_FULL_SERVER_RESPONSE {
                    continue;
                }

                let Some(raw_payload) = volcengine_response_payload(&data, header_byte_len) else {
                    continue;
                };
                let payload_bytes = if compression == VOLC_COMPRESS_GZIP {
                    gzip_decompress(&raw_payload).unwrap_or(raw_payload)
                } else {
                    raw_payload
                };

                if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&payload_bytes) {
                    let text = volcengine_response_text(&parsed).unwrap_or("");
                    if text.is_empty() {
                        continue;
                    }

                    accumulated_text = text.to_string();
                    let expected_audio_duration_ms =
                        (total_audio_bytes as u64).saturating_mul(1000) / 32_000;
                    let response_audio_ms = parsed
                        .pointer("/audio_info/duration")
                        .and_then(|value| value.as_u64())
                        .unwrap_or_default();

                    let is_final_result = msg_flags == VOLC_FLAGS_ASYNC_FINAL_RESPONSE
                        || msg_flags == VOLC_FLAGS_NEGATIVE_SEQUENCE_LAST
                        || volcengine_response_is_definite(&parsed);

                    let _ = app.emit(
                        "volcengine-streaming-transcript",
                        VolcengineStreamingTranscriptEvent {
                            session_id: session_id.clone(),
                            text: accumulated_text.clone(),
                            is_final: is_final_result,
                            audio_ms: (response_audio_ms > 0).then_some(response_audio_ms),
                            definite: volcengine_response_is_definite(&parsed),
                        },
                    );

                    if finish_requested
                        && is_final_result
                        && (response_audio_ms == 0
                            || response_audio_ms + 250 >= expected_audio_duration_ms)
                    {
                        eprintln!(
                            "[volcengine-stream] final result session={} chars={} response_audio_ms={} expected_audio_ms={}",
                            session_id,
                            accumulated_text.len(),
                            response_audio_ms,
                            expected_audio_duration_ms
                        );
                        return Ok(accumulated_text);
                    }
                }
            }
            _ = sleep(Duration::from_millis(100)), if finish_requested => {
                if finish_started_at
                    .map(|started| started.elapsed() > Duration::from_secs(8))
                    .unwrap_or(false)
                {
                    if accumulated_text.trim().is_empty() {
                        return Err("Volcengine streaming ASR returned no transcription result".to_string());
                    }
                    eprintln!(
                        "[volcengine-stream] final wait timeout session={} using latest chars={}",
                        session_id,
                        accumulated_text.len()
                    );
                    return Ok(accumulated_text);
                }
            }
        }
    }

    if accumulated_text.trim().is_empty() {
        Err("Volcengine streaming ASR returned no transcription result".to_string())
    } else {
        Ok(accumulated_text)
    }
}

fn volcengine_error_packet_to_string(data: &[u8], header_byte_len: usize) -> String {
    let mut error_msg = "Volcengine ASR server error".to_string();
    let h = header_byte_len;

    if data.len() >= h + 8 {
        let code = u32::from_be_bytes(data[h..h + 4].try_into().unwrap_or([0; 4]));
        let msg_size = u32::from_be_bytes(data[h + 4..h + 8].try_into().unwrap_or([0; 4])) as usize;

        if msg_size > 0 && data.len() >= h + 8 + msg_size {
            let raw = &data[h + 8..h + 8 + msg_size];
            error_msg = String::from_utf8_lossy(raw).to_string();
        } else if data.len() > h + 8 {
            let raw = &data[h + 8..];
            error_msg = String::from_utf8_lossy(raw).to_string();
        }
        return format!("Volcengine error {}: {}", code, error_msg);
    }

    if data.len() > h {
        error_msg = String::from_utf8_lossy(&data[h..]).to_string();
    }

    error_msg
}
