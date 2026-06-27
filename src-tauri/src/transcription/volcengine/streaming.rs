use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::OnceLock;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

use crate::commands::{
    command_error::{CommandError, CommandResult},
    vocabulary,
};
use crate::transcription::domain::{
    emit_transcript_event, TranscriptEvent, VOLCENGINE_STREAMING_TRANSCRIPT_EVENT_NAME,
};
use crate::transcription::providers::BatchProvider;

use super::protocol::{
    decode_volcengine_server_packet, normalize_volcengine_resource_id, VolcengineMode,
    VolcengineServerPacket,
};
use super::runtime::{
    connect_volcengine_ws, send_volcengine_audio, send_volcengine_config,
    VolcengineConnectLogScope, VolcengineConnection,
};

enum VolcengineStreamCommand {
    Audio(Vec<u8>),
    Finish,
    Cancel,
}

struct VolcengineStreamingSession {
    tx: mpsc::Sender<VolcengineStreamCommand>,
    handle: JoinHandle<Result<String, String>>,
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
pub(crate) async fn start_volcengine_streaming_transcription(
    app: AppHandle,
    app_id: String,
    access_token: String,
    resource_id: Option<String>,
    model: Option<String>,
    language: Option<String>,
) -> CommandResult<String> {
    let provider = BatchProvider::Volcengine;
    if !provider.supports_streaming() {
        return Err(CommandError::internal(
            "Volcengine provider is not configured for streaming transcription",
        ));
    }

    let access_token = access_token.trim().to_string();
    let app_id = app_id.trim().to_string();
    if access_token.is_empty() {
        return Err(CommandError::configuration(
            "Volcengine API Key or Access Token is required",
        ));
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

pub(crate) async fn send_volcengine_streaming_audio(
    session_id: String,
    audio_data: Vec<u8>,
) -> CommandResult<()> {
    if audio_data.is_empty() {
        return Ok(());
    }

    let tx = {
        let sessions = volcengine_streaming_sessions().lock().await;
        sessions
            .get(&session_id)
            .map(|session| session.tx.clone())
            .ok_or_else(|| CommandError::internal("Volcengine streaming session not found"))?
    };

    match tx.send(VolcengineStreamCommand::Audio(audio_data)).await {
        Ok(()) => Ok(()),
        Err(_) => {
            let session = {
                let mut sessions = volcengine_streaming_sessions().lock().await;
                sessions.remove(&session_id)
            };

            let Some(session) = session else {
                return Err(CommandError::internal(
                    "Volcengine streaming session is closed",
                ));
            };

            match session.handle.await {
                Ok(Ok(_)) => Err(CommandError::internal(
                    "Volcengine streaming session finished before audio upload",
                )),
                Ok(Err(err)) => Err(CommandError::from(err)),
                Err(err) => Err(CommandError::internal(format!(
                    "Volcengine streaming task failed: {err}"
                ))),
            }
        }
    }
}

pub(crate) async fn finish_volcengine_streaming_transcription(
    session_id: String,
) -> CommandResult<String> {
    let session = {
        let mut sessions = volcengine_streaming_sessions().lock().await;
        sessions
            .remove(&session_id)
            .ok_or_else(|| CommandError::internal("Volcengine streaming session not found"))?
    };

    let _ = session.tx.send(VolcengineStreamCommand::Finish).await;

    let mut handle = session.handle;
    tokio::select! {
        join_result = &mut handle => {
            join_result
                .map_err(|e| CommandError::internal(format!("Volcengine streaming task failed: {e}")))?
                .map_err(CommandError::from)
        }
        _ = sleep(Duration::from_secs(20)) => {
            handle.abort();
            Err(CommandError::timeout("Volcengine streaming transcription timed out after finish"))
        }
    }
}

pub(crate) async fn cancel_volcengine_streaming_transcription(
    session_id: String,
) -> CommandResult<()> {
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
    let provider_id = BatchProvider::Volcengine.id();
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

    let VolcengineConnection {
        auth_mode,
        ws_stream,
        log_id,
    } = connect_volcengine_ws(
        ws_url,
        &resource_id,
        &app_id,
        &access_token,
        &connect_id,
        "Volcengine streaming ASR",
        "Volcengine streaming ASR connect failed",
        VolcengineConnectLogScope::Streaming {
            session_id: &session_id,
        },
    )
    .await?;
    eprintln!(
        "[volcengine-stream] connected session={} auth_mode={} connect_id={} log_id={}",
        session_id,
        auth_mode.label(),
        connect_id,
        log_id
    );

    let (mut write, mut read) = ws_stream.split();

    let hotwords = vocabulary::load_effective_hotwords(&app);
    send_volcengine_config(
        &mut write,
        &app_id,
        &access_token,
        &resource_id,
        mode,
        language.as_deref(),
        &hotwords,
        "Volcengine streaming send config",
    )
    .await?;

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
                        send_volcengine_audio(
                            &mut write,
                            &data,
                            false,
                            "Volcengine streaming send audio",
                        )
                        .await?;
                        total_audio_bytes += data.len();
                        audio_packet_count += 1;
                    }
                    Some(VolcengineStreamCommand::Finish) => {
                        if !finish_requested {
                            send_volcengine_audio(
                                &mut write,
                                &[],
                                true,
                                "Volcengine streaming send finish",
                            )
                            .await?;
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

                match decode_volcengine_server_packet(&data) {
                    VolcengineServerPacket::Ack | VolcengineServerPacket::Ignore => continue,
                    VolcengineServerPacket::Error(error) => {
                        if finish_requested && !accumulated_text.trim().is_empty() {
                            eprintln!(
                                "[volcengine-stream] server closed after finish session={} chars={}",
                                session_id,
                                accumulated_text.len()
                            );
                            return Ok(accumulated_text);
                        }
                        return Err(error.message);
                    }
                    VolcengineServerPacket::Response(response) => {
                        if response.text.is_empty() {
                            continue;
                        }

                        accumulated_text = response.text;
                        let expected_audio_duration_ms =
                            (total_audio_bytes as u64).saturating_mul(1000) / 32_000;

                        emit_transcript_event(
                            &app,
                            VOLCENGINE_STREAMING_TRANSCRIPT_EVENT_NAME,
                            TranscriptEvent::streaming(
                                provider_id,
                                session_id.clone(),
                                accumulated_text.clone(),
                                response.is_final,
                            )
                            .with_audio_ms((response.audio_ms > 0).then_some(response.audio_ms))
                            .with_definite(response.is_definite),
                        );

                        if finish_requested
                            && response.is_final
                            && (response.audio_ms == 0
                                || response.audio_ms + 250 >= expected_audio_duration_ms)
                        {
                            eprintln!(
                                "[volcengine-stream] final result session={} chars={} response_audio_ms={} expected_audio_ms={}",
                                session_id,
                                accumulated_text.len(),
                                response.audio_ms,
                                expected_audio_duration_ms
                            );
                            return Ok(accumulated_text);
                        }
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
