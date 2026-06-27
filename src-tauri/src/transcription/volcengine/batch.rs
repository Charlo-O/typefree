use futures_util::StreamExt;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::tungstenite::Message;

use super::protocol::{
    decode_volcengine_server_packet, normalize_volcengine_audio, normalize_volcengine_resource_id,
    volcengine_pcm_duration_ms, VolcengineMode, VolcengineServerPacket,
};
use super::runtime::{
    connect_volcengine_ws, send_volcengine_audio, send_volcengine_config,
    VolcengineConnectLogScope, VolcengineConnection,
};

fn payload_keys(payload: &serde_json::Value) -> String {
    payload
        .as_object()
        .map(|object| {
            let mut keys = object.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            keys.join(",")
        })
        .filter(|keys| !keys.is_empty())
        .unwrap_or_else(|| "-".to_string())
}

pub(crate) async fn transcribe_volcengine(
    audio_data: Vec<u8>,
    app_id: String,
    access_token: String,
    resource_id: String,
    model: Option<String>,
    language: Option<String>,
    hotwords: Vec<String>,
) -> Result<String, String> {
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
        "Volcengine ASR",
        "Volcengine ASR connect failed",
        VolcengineConnectLogScope::Batch,
    )
    .await?;
    eprintln!(
        "[volcengine] connected auth_mode={} connect_id={} log_id={}",
        auth_mode.label(),
        connect_id,
        log_id
    );

    let (mut write, mut read) = ws_stream.split();

    eprintln!(
        "[volcengine] config prepared auth_mode={} mode={} resource={} audio_ms={} hotwords={}",
        auth_mode.label(),
        mode.label(),
        resource_id,
        expected_audio_duration_ms,
        hotwords.len()
    );

    send_volcengine_config(
        &mut write,
        &app_id,
        &access_token,
        &resource_id,
        mode,
        language.as_deref(),
        &hotwords,
        "WS send config",
    )
    .await?;

    let chunk_size = 6400usize;
    let chunk_interval_ms = 100u64;
    let total_chunks = audio_data.len().div_ceil(chunk_size);

    for i in 0..total_chunks {
        let start = i * chunk_size;
        let end = std::cmp::min(start + chunk_size, audio_data.len());
        let chunk = &audio_data[start..end];
        let is_last = i == total_chunks - 1;
        send_volcengine_audio(&mut write, chunk, is_last, "WS send audio").await?;

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

    let mut accumulated_text = String::new();

    while let Some(msg) = read.next().await {
        let msg = msg.map_err(|e| format!("WS read: {e}"))?;
        let data = match msg {
            Message::Binary(b) => b.to_vec(),
            Message::Close(_) => break,
            _ => continue,
        };

        match decode_volcengine_server_packet(&data) {
            VolcengineServerPacket::Ack | VolcengineServerPacket::Ignore => continue,
            VolcengineServerPacket::Error(error) => {
                eprintln!(
                    "[volcengine] error packet raw ({} bytes): {}",
                    data.len(),
                    error.raw_hex
                );
                eprintln!("[volcengine] server error: {}", error.message);
                return Err(error.message);
            }
            VolcengineServerPacket::Response(response) => {
                eprintln!(
                    "[volcengine] response summary: has_text={} text_chars={} audio_ms={} is_final={} is_definite={} payload_keys={}",
                    !response.text.is_empty(),
                    response.text.chars().count(),
                    response.audio_ms,
                    response.is_final,
                    response.is_definite,
                    payload_keys(&response.payload)
                );

                if !response.text.is_empty() {
                    accumulated_text = response.text;

                    if response.is_final && response.audio_ms + 250 >= expected_audio_duration_ms {
                        eprintln!(
                            "[volcengine] final result ready before close: chars={} response_audio_ms={} expected_audio_ms={}",
                            accumulated_text.len(),
                            response.audio_ms,
                            expected_audio_duration_ms
                        );
                        return Ok(accumulated_text);
                    }
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
