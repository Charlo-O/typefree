use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::time::{sleep, timeout, Duration, Instant};

#[cfg(target_os = "macos")]
use std::path::PathBuf;

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

    // Volcengine uses separate credentials (appId, accessToken, resourceId)
    if provider == "volcengine" {
        let app_id = super::settings::get_env_var(app.clone(), "VOLCENGINE_APP_ID".to_string())?
            .ok_or_else(|| "VOLCENGINE_APP_ID not found. Please set your Volcengine APP ID.".to_string())?;
        let access_token = super::settings::get_env_var(app.clone(), "VOLCENGINE_ACCESS_TOKEN".to_string())?
            .ok_or_else(|| "VOLCENGINE_ACCESS_TOKEN not found. Please set your Volcengine Access Token.".to_string())?;
        let resource_id = super::settings::get_env_var(app.clone(), "VOLCENGINE_RESOURCE_ID".to_string())?
            .unwrap_or_else(|| "volc.bigasr.sauc.duration".to_string());

        return timeout(Duration::from_secs(60), async move {
            transcribe_volcengine(audio_data, app_id, access_token, resource_id, model, language).await
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
    encoder.write_all(data).map_err(|e| format!("gzip compress: {e}"))?;
    encoder.finish().map_err(|e| format!("gzip finish: {e}"))
}

fn gzip_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(data);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).map_err(|e| format!("gzip decompress: {e}"))?;
    Ok(out)
}

async fn transcribe_volcengine(
    audio_data: Vec<u8>,
    app_id: String,
    access_token: String,
    resource_id: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    use tokio_tungstenite::tungstenite::{self, Message};
    use futures_util::{SinkExt, StreamExt};

    // Validate resource_id format: must start with "volc." (e.g. volc.seedasr.sauc.duration)
    // If user entered a Volcengine console resource name instead, fall back to default
    let resource_id = if resource_id.starts_with("volc.") {
        resource_id
    } else {
        eprintln!("[volcengine] invalid resource_id '{}', falling back to volc.bigasr.sauc.duration", resource_id);
        "volc.bigasr.sauc.duration".to_string()
    };

    // Use bigmodel (streaming) by default; bigmodel_async only if explicitly requested
    let ws_url = match model.as_deref() {
        Some("volcengine-bigmodel-async") => "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
        _ => "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel",
    };

    eprintln!("[volcengine] connecting to {} resource={}", ws_url, resource_id);

    // Build HTTP request with custom headers (required by Volcengine)
    let uri: http::Uri = ws_url.parse().map_err(|e: http::uri::InvalidUri| e.to_string())?;
    let host = uri.host().unwrap_or("openspeech.bytedance.com");

    let request = http::Request::builder()
        .uri(ws_url)
        .header("Host", host)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", tungstenite::handshake::client::generate_key())
        .header("X-Api-App-Key", &app_id)
        .header("X-Api-Access-Key", &access_token)
        .header("X-Api-Resource-Id", &resource_id)
        .body(())
        .map_err(|e| format!("Failed to build WS request: {e}"))?;

    let (ws_stream, _response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("Failed to connect to Volcengine ASR: {e}"))?;

    eprintln!("[volcengine] connected");

    let (mut write, mut read) = ws_stream.split();

    // 1. Send config packet
    let lang = match language.as_deref() {
        Some("auto") | None => "zh-CN",
        Some(l) => l,
    };
    let config_payload = serde_json::json!({
        "app": { "appid": app_id, "cluster": resource_id, "token": access_token },
        "user": { "uid": "openwhispr-user" },
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
        "audio": { "format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1, "language": lang },
    });

    eprintln!("[volcengine] config payload: {}", serde_json::to_string_pretty(&config_payload).unwrap_or_default());

    let json_bytes = serde_json::to_vec(&config_payload).map_err(|e| e.to_string())?;
    let compressed = gzip_compress(&json_bytes)?;

    let header = volc_build_header(VOLC_MSG_FULL_CLIENT_REQUEST, VOLC_FLAGS_NONE, VOLC_SERIAL_JSON, VOLC_COMPRESS_GZIP);
    let mut packet = Vec::with_capacity(4 + 4 + compressed.len());
    packet.extend_from_slice(&header);
    packet.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
    packet.extend_from_slice(&compressed);

    write.send(Message::Binary(packet.into())).await.map_err(|e| format!("WS send config: {e}"))?;

    // 2. Send audio in ~200ms chunks (PCM 16kHz mono 16-bit = 6400 bytes per chunk)
    // audio_data is raw PCM (WAV header already stripped by frontend)
    let chunk_size = 6400usize;
    let total_chunks = (audio_data.len() + chunk_size - 1) / chunk_size;

    for i in 0..total_chunks {
        let start = i * chunk_size;
        let end = std::cmp::min(start + chunk_size, audio_data.len());
        let chunk = &audio_data[start..end];
        let is_last = i == total_chunks - 1;

        let audio_header = volc_build_header(
            VOLC_MSG_AUDIO_ONLY,
            if is_last { VOLC_FLAGS_LAST_AUDIO } else { VOLC_FLAGS_NONE },
            0x00,
            0x00,
        );
        let mut audio_packet = Vec::with_capacity(4 + 4 + chunk.len());
        audio_packet.extend_from_slice(&audio_header);
        audio_packet.extend_from_slice(&(chunk.len() as u32).to_be_bytes());
        audio_packet.extend_from_slice(chunk);

        write.send(Message::Binary(audio_packet.into())).await.map_err(|e| format!("WS send audio: {e}"))?;

        if !is_last {
            sleep(Duration::from_millis(20)).await;
        }
    }

    eprintln!("[volcengine] sent {} audio chunks ({} bytes)", total_chunks, audio_data.len());

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
        let compression = data[2] & 0x0f;
        let header_byte_len = (data[0] & 0x0f) as usize * 4;

        if msg_type == VOLC_MSG_SERVER_ACK {
            continue;
        }

        if msg_type == VOLC_MSG_SERVER_ERROR {
            // Dump raw bytes for debugging
            let hex: Vec<String> = data.iter().take(128).map(|b| format!("{:02x}", b)).collect();
            eprintln!("[volcengine] error packet raw ({} bytes): {}", data.len(), hex.join(" "));

            // Error packet format per spec: Header(4) + ErrorCode(4) + MessageSize(4) + UTF-8 string
            let mut error_msg = "Volcengine ASR server error".to_string();
            let h = header_byte_len; // typically 4

            if data.len() >= h + 8 {
                let code = u32::from_be_bytes(
                    data[h..h + 4].try_into().unwrap_or([0; 4])
                );
                let msg_size = u32::from_be_bytes(
                    data[h + 4..h + 8].try_into().unwrap_or([0; 4])
                ) as usize;
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

        if data.len() <= header_byte_len + 8 {
            continue;
        }

        let _sequence = u32::from_be_bytes(
            data[header_byte_len..header_byte_len + 4].try_into().unwrap_or([0; 4])
        );
        let payload_size = u32::from_be_bytes(
            data[header_byte_len + 4..header_byte_len + 8].try_into().unwrap_or([0; 4])
        ) as usize;

        if payload_size == 0 || data.len() < header_byte_len + 8 + payload_size {
            continue;
        }

        let raw_payload = &data[header_byte_len + 8..header_byte_len + 8 + payload_size];
        let payload_bytes = if compression == VOLC_COMPRESS_GZIP {
            gzip_decompress(raw_payload).unwrap_or_else(|_| raw_payload.to_vec())
        } else {
            raw_payload.to_vec()
        };

        if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&payload_bytes) {
            eprintln!("[volcengine] response payload: {}", serde_json::to_string(&parsed).unwrap_or_default());

            // result can be an array of objects with "text" field, or an object with "text"
            let text = parsed.get("result")
                .and_then(|r| {
                    if let Some(arr) = r.as_array() {
                        // Array format: [{"text": "...", ...}]
                        arr.first().and_then(|item| item.get("text").and_then(|v| v.as_str()))
                    } else {
                        // Object format: {"text": "..."}
                        r.get("text").and_then(|v| v.as_str())
                    }
                })
                .or_else(|| parsed.get("text").and_then(|v| v.as_str()))
                .unwrap_or("");

            if !text.is_empty() {
                accumulated_text = text.to_string();
            }
        }
    }

    if accumulated_text.is_empty() {
        Err("Volcengine ASR returned no transcription result".to_string())
    } else {
        eprintln!("[volcengine] transcription complete: {} chars", accumulated_text.len());
        Ok(accumulated_text)
    }
}
