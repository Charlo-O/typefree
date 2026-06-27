use futures_util::{Sink, SinkExt};
use tokio_tungstenite::tungstenite::Message;

use super::protocol::{
    build_volcengine_audio_packet, build_volcengine_config_packet, build_volcengine_ws_request,
    should_retry_volcengine_auth, volcengine_auth_modes, VolcengineAuthMode,
    VolcengineConfigPacket, VolcengineMode,
};

pub(super) type VolcengineWsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

#[derive(Clone, Copy)]
pub(super) enum VolcengineConnectLogScope<'a> {
    Batch,
    Streaming { session_id: &'a str },
}

impl VolcengineConnectLogScope<'_> {
    fn log_failed(self, auth_mode: VolcengineAuthMode, message: &str) {
        match self {
            Self::Batch => eprintln!(
                "[volcengine] connect failed auth_mode={} error={}",
                auth_mode.label(),
                message
            ),
            Self::Streaming { session_id } => eprintln!(
                "[volcengine-stream] connect failed session={} auth_mode={} error={}",
                session_id,
                auth_mode.label(),
                message
            ),
        }
    }
}

pub(super) struct VolcengineConnection {
    pub(super) auth_mode: VolcengineAuthMode,
    pub(super) ws_stream: VolcengineWsStream,
    pub(super) log_id: String,
}

pub(super) async fn connect_volcengine_ws(
    ws_url: &str,
    resource_id: &str,
    app_id: &str,
    access_token: &str,
    connect_id: &str,
    failure_label: &str,
    fallback_error: &str,
    log_scope: VolcengineConnectLogScope<'_>,
) -> Result<VolcengineConnection, String> {
    let mut last_connect_error = None;
    for auth_mode in volcengine_auth_modes(app_id) {
        let request = build_volcengine_ws_request(
            ws_url,
            resource_id,
            connect_id,
            app_id,
            access_token,
            auth_mode,
        )?;

        match tokio_tungstenite::connect_async(request).await {
            Ok((ws_stream, response)) => {
                let log_id = response
                    .headers()
                    .get("X-Tt-Logid")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                return Ok(VolcengineConnection {
                    auth_mode,
                    ws_stream,
                    log_id,
                });
            }
            Err(err) => {
                let message = format!("Failed to connect to {failure_label}: {err}");
                log_scope.log_failed(auth_mode, &message);
                if should_retry_volcengine_auth(&message, auth_mode) {
                    last_connect_error = Some(message);
                    continue;
                }
                return Err(message);
            }
        }
    }

    Err(last_connect_error.unwrap_or_else(|| fallback_error.to_string()))
}

pub(super) async fn send_volcengine_config<S>(
    write: &mut S,
    app_id: &str,
    access_token: &str,
    resource_id: &str,
    mode: VolcengineMode,
    language: Option<&str>,
    hotwords: &[String],
    error_context: &str,
) -> Result<(), String>
where
    S: Sink<Message> + Unpin,
    S::Error: std::fmt::Display,
{
    let packet = build_volcengine_config_packet(VolcengineConfigPacket {
        app_id,
        access_token,
        resource_id,
        mode,
        language,
        hotwords,
        request_id: uuid::Uuid::new_v4().to_string(),
    })?;

    write
        .send(Message::Binary(packet.into()))
        .await
        .map_err(|e| format!("{error_context}: {e}"))
}

pub(super) async fn send_volcengine_audio<S>(
    write: &mut S,
    chunk: &[u8],
    is_last: bool,
    error_context: &str,
) -> Result<(), String>
where
    S: Sink<Message> + Unpin,
    S::Error: std::fmt::Display,
{
    let audio_packet = build_volcengine_audio_packet(chunk, is_last);
    write
        .send(Message::Binary(audio_packet.into()))
        .await
        .map_err(|e| format!("{error_context}: {e}"))
}
