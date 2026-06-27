use std::collections::HashMap;
use std::sync::OnceLock;

use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration, Instant};

use crate::commands::command_error::{CommandError, CommandResult};
use crate::transcription::domain::{
    emit_transcript_event, TranscriptEvent, OPENAI_REALTIME_TRANSCRIPT_EVENT_NAME,
};
use crate::transcription::providers::BatchProvider;

enum OpenAIRealtimeCommand {
    Audio(Vec<u8>),
    Finish,
    Cancel,
}

struct OpenAIRealtimeSession {
    tx: mpsc::Sender<OpenAIRealtimeCommand>,
    handle: JoinHandle<Result<String, String>>,
}

static OPENAI_REALTIME_SESSIONS: OnceLock<Mutex<HashMap<String, OpenAIRealtimeSession>>> =
    OnceLock::new();

fn openai_realtime_sessions() -> &'static Mutex<HashMap<String, OpenAIRealtimeSession>> {
    OPENAI_REALTIME_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Start a low-latency OpenAI realtime transcription session.
///
/// Audio is expected to be 24 kHz mono PCM16, matching OpenAI's realtime
/// transcription session format.
pub(crate) async fn start_openai_realtime_transcription(
    app: AppHandle,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
    delay: Option<String>,
) -> CommandResult<String> {
    let provider = BatchProvider::OpenAI;
    if !provider.supports_realtime() {
        return Err(CommandError::internal(
            "OpenAI provider is not configured for realtime transcription",
        ));
    }

    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err(CommandError::configuration("OpenAI API key is required"));
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel::<OpenAIRealtimeCommand>(512);

    let handle = tokio::spawn(run_openai_realtime_session(
        app,
        rx,
        api_key,
        model,
        language,
        delay,
        session_id.clone(),
    ));

    openai_realtime_sessions()
        .lock()
        .await
        .insert(session_id.clone(), OpenAIRealtimeSession { tx, handle });

    Ok(session_id)
}

pub(crate) async fn send_openai_realtime_audio(
    session_id: String,
    audio_data: Vec<u8>,
) -> CommandResult<()> {
    if audio_data.is_empty() {
        return Ok(());
    }

    let tx = {
        let sessions = openai_realtime_sessions().lock().await;
        sessions
            .get(&session_id)
            .map(|session| session.tx.clone())
            .ok_or_else(|| CommandError::internal("OpenAI realtime session not found"))?
    };

    match tx.send(OpenAIRealtimeCommand::Audio(audio_data)).await {
        Ok(()) => Ok(()),
        Err(_) => {
            let session = {
                let mut sessions = openai_realtime_sessions().lock().await;
                sessions.remove(&session_id)
            };

            let Some(session) = session else {
                return Err(CommandError::internal("OpenAI realtime session is closed"));
            };

            match session.handle.await {
                Ok(Ok(_)) => Err(CommandError::internal(
                    "OpenAI realtime session finished before audio upload",
                )),
                Ok(Err(err)) => Err(CommandError::from(err)),
                Err(err) => Err(CommandError::internal(format!(
                    "OpenAI realtime task failed: {err}"
                ))),
            }
        }
    }
}

pub(crate) async fn finish_openai_realtime_transcription(
    session_id: String,
) -> CommandResult<String> {
    let session = {
        let mut sessions = openai_realtime_sessions().lock().await;
        sessions
            .remove(&session_id)
            .ok_or_else(|| CommandError::internal("OpenAI realtime session not found"))?
    };

    let _ = session.tx.send(OpenAIRealtimeCommand::Finish).await;

    let mut handle = session.handle;
    tokio::select! {
        join_result = &mut handle => {
            join_result
                .map_err(|e| CommandError::internal(format!("OpenAI realtime task failed: {e}")))?
                .map_err(CommandError::from)
        }
        _ = sleep(Duration::from_secs(20)) => {
            handle.abort();
            Err(CommandError::timeout("OpenAI realtime transcription timed out after finish"))
        }
    }
}

pub(crate) async fn cancel_openai_realtime_transcription(session_id: String) -> CommandResult<()> {
    let session = {
        let mut sessions = openai_realtime_sessions().lock().await;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        let _ = session.tx.send(OpenAIRealtimeCommand::Cancel).await;
        session.handle.abort();
    }

    Ok(())
}

fn normalize_openai_realtime_delay(delay: Option<&str>) -> String {
    match delay.map(str::trim).filter(|value| !value.is_empty()) {
        Some("minimal") | Some("low") | Some("medium") | Some("high") | Some("xhigh") => {
            delay.unwrap().trim().to_string()
        }
        _ => "low".to_string(),
    }
}

fn normalize_openai_realtime_language(language: Option<&str>) -> Option<String> {
    language
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "auto")
        .map(ToString::to_string)
}

fn normalize_openai_realtime_model(model: Option<&str>) -> String {
    model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("gpt-realtime-whisper")
        .to_string()
}

fn openai_realtime_error_message(parsed: &serde_json::Value) -> String {
    let error = parsed.get("error").unwrap_or(parsed);
    let message = error
        .get("message")
        .and_then(|value| value.as_str())
        .or_else(|| parsed.get("message").and_then(|value| value.as_str()))
        .unwrap_or("OpenAI realtime API error");
    let code = error
        .get("code")
        .and_then(|value| value.as_str())
        .or_else(|| error.get("type").and_then(|value| value.as_str()))
        .unwrap_or("");

    if code.is_empty() {
        message.to_string()
    } else {
        format!("{message} ({code})")
    }
}

async fn run_openai_realtime_session(
    app: AppHandle,
    mut rx: mpsc::Receiver<OpenAIRealtimeCommand>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
    delay: Option<String>,
    session_id: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::{self, Message};

    let realtime_model = "gpt-realtime-2";
    let provider_id = BatchProvider::OpenAI.id();
    let transcription_model = normalize_openai_realtime_model(model.as_deref());
    let transcription_delay = normalize_openai_realtime_delay(delay.as_deref());
    let normalized_language = normalize_openai_realtime_language(language.as_deref());
    let ws_url = format!("wss://api.openai.com/v1/realtime?model={realtime_model}");

    eprintln!(
        "[openai-realtime] connecting session={} realtime_model={} transcription_model={} delay={}",
        session_id, realtime_model, transcription_model, transcription_delay
    );

    let uri: http::Uri = ws_url
        .parse()
        .map_err(|e: http::uri::InvalidUri| e.to_string())?;
    let host = uri.host().unwrap_or("api.openai.com");

    let request = http::Request::builder()
        .uri(ws_url.as_str())
        .header("Host", host)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header(
            "Sec-WebSocket-Key",
            tungstenite::handshake::client::generate_key(),
        )
        .header("Authorization", format!("Bearer {api_key}"))
        .body(())
        .map_err(|e| format!("Failed to build OpenAI realtime request: {e}"))?;

    let (ws_stream, response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("Failed to connect to OpenAI realtime transcription: {e}"))?;

    eprintln!(
        "[openai-realtime] connected session={} status={}",
        session_id,
        response.status()
    );

    let (mut write, mut read) = ws_stream.split();

    let mut transcription_payload = serde_json::json!({
        "model": transcription_model,
        "delay": transcription_delay,
    });
    if let Some(language) = normalized_language {
        transcription_payload["language"] = serde_json::Value::String(language);
    }

    let session_update = serde_json::json!({
        "type": "session.update",
        "session": {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": {
                        "type": "audio/pcm",
                        "rate": 24000,
                    },
                    "turn_detection": serde_json::Value::Null,
                    "transcription": transcription_payload,
                }
            }
        }
    });

    write
        .send(Message::Text(session_update.to_string()))
        .await
        .map_err(|e| format!("OpenAI realtime send session update: {e}"))?;

    let mut accumulated_text = String::new();
    let mut finish_requested = false;
    let mut finish_started_at: Option<Instant> = None;
    let mut command_channel_closed = false;
    let mut audio_chunk_count = 0usize;
    let mut total_audio_bytes = 0usize;

    loop {
        tokio::select! {
            maybe_command = rx.recv(), if !command_channel_closed => {
                match maybe_command {
                    Some(OpenAIRealtimeCommand::Audio(data)) => {
                        if finish_requested || data.is_empty() {
                            continue;
                        }

                        let payload = serde_json::json!({
                            "type": "input_audio_buffer.append",
                            "audio": general_purpose::STANDARD.encode(&data),
                        });
                        write
                            .send(Message::Text(payload.to_string()))
                            .await
                            .map_err(|e| format!("OpenAI realtime send audio: {e}"))?;
                        audio_chunk_count += 1;
                        total_audio_bytes += data.len();
                    }
                    Some(OpenAIRealtimeCommand::Finish) => {
                        if !finish_requested {
                            write
                                .send(Message::Text(
                                    serde_json::json!({ "type": "input_audio_buffer.commit" }).to_string(),
                                ))
                                .await
                                .map_err(|e| format!("OpenAI realtime send finish: {e}"))?;
                            finish_requested = true;
                            finish_started_at = Some(Instant::now());
                            eprintln!(
                                "[openai-realtime] finish sent session={} chunks={} bytes={}",
                                session_id, audio_chunk_count, total_audio_bytes
                            );
                        }
                    }
                    Some(OpenAIRealtimeCommand::Cancel) => {
                        let _ = write.close().await;
                        return Err("OpenAI realtime transcription cancelled".to_string());
                    }
                    None => {
                        if finish_requested {
                            command_channel_closed = true;
                        } else {
                            let _ = write.close().await;
                            return Err("OpenAI realtime transcription cancelled".to_string());
                        }
                    }
                }
            }
            maybe_message = read.next() => {
                let Some(message) = maybe_message else {
                    break;
                };
                let message = message.map_err(|e| format!("OpenAI realtime read: {e}"))?;
                let text = match message {
                    Message::Text(text) => text.to_string(),
                    Message::Binary(data) => String::from_utf8_lossy(&data).to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };

                let parsed: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let event_type = parsed
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");

                match event_type {
                    "conversation.item.input_audio_transcription.delta" => {
                        let delta = parsed
                            .get("delta")
                            .and_then(|value| value.as_str())
                            .unwrap_or("");
                        if delta.is_empty() {
                            continue;
                        }

                        accumulated_text.push_str(delta);
                        let item_id = parsed
                            .get("item_id")
                            .and_then(|value| value.as_str())
                            .map(ToString::to_string);

                        emit_transcript_event(
                            &app,
                            OPENAI_REALTIME_TRANSCRIPT_EVENT_NAME,
                            TranscriptEvent::realtime_delta(
                                provider_id,
                                session_id.clone(),
                                accumulated_text.clone(),
                                delta.to_string(),
                                item_id,
                            ),
                        );
                    }
                    "conversation.item.input_audio_transcription.completed" => {
                        let transcript = parsed
                            .get("transcript")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        if !transcript.is_empty() {
                            accumulated_text = transcript;
                        }

                        let item_id = parsed
                            .get("item_id")
                            .and_then(|value| value.as_str())
                            .map(ToString::to_string);
                        emit_transcript_event(
                            &app,
                            OPENAI_REALTIME_TRANSCRIPT_EVENT_NAME,
                            TranscriptEvent::realtime_final(
                                provider_id,
                                session_id.clone(),
                                accumulated_text.clone(),
                                item_id,
                            ),
                        );

                        if accumulated_text.trim().is_empty() {
                            return Err("OpenAI realtime ASR returned no transcription result".to_string());
                        }
                        eprintln!(
                            "[openai-realtime] final result session={} chars={}",
                            session_id,
                            accumulated_text.len()
                        );
                        return Ok(accumulated_text);
                    }
                    "error" => {
                        return Err(openai_realtime_error_message(&parsed));
                    }
                    _ => {}
                }
            }
            _ = sleep(Duration::from_millis(100)), if finish_requested => {
                if finish_started_at
                    .map(|started| started.elapsed() > Duration::from_secs(12))
                    .unwrap_or(false)
                {
                    if accumulated_text.trim().is_empty() {
                        return Err("OpenAI realtime ASR returned no transcription result".to_string());
                    }
                    eprintln!(
                        "[openai-realtime] final wait timeout session={} using latest chars={}",
                        session_id,
                        accumulated_text.len()
                    );
                    return Ok(accumulated_text);
                }
            }
        }
    }

    if accumulated_text.trim().is_empty() {
        Err("OpenAI realtime ASR returned no transcription result".to_string())
    } else {
        Ok(accumulated_text)
    }
}
