use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::{Read as IoRead, Write as IoWrite};

pub(super) const VOLC_MSG_FULL_CLIENT_REQUEST: u8 = 0x01;
pub(super) const VOLC_MSG_AUDIO_ONLY: u8 = 0x02;
pub(super) const VOLC_MSG_FULL_SERVER_RESPONSE: u8 = 0x09;
pub(super) const VOLC_MSG_SERVER_ACK: u8 = 0x0b;
pub(super) const VOLC_MSG_SERVER_ERROR: u8 = 0x0f;
pub(super) const VOLC_FLAGS_NONE: u8 = 0x00;
pub(super) const VOLC_FLAGS_LAST_AUDIO: u8 = 0x02;
pub(super) const VOLC_FLAGS_NEGATIVE_SEQUENCE_LAST: u8 = 0x03;
pub(super) const VOLC_FLAGS_ASYNC_FINAL_RESPONSE: u8 = 0x04;
pub(super) const VOLC_SERIAL_JSON: u8 = 0x01;
pub(super) const VOLC_COMPRESS_GZIP: u8 = 0x01;

const VOLC_PROTOCOL_VERSION: u8 = 0x01;
const VOLC_HEADER_SIZE: u8 = 0x01; // 1 * 4 bytes

pub(super) fn volc_build_header(
    msg_type: u8,
    flags: u8,
    serialization: u8,
    compression: u8,
) -> [u8; 4] {
    [
        (VOLC_PROTOCOL_VERSION << 4) | VOLC_HEADER_SIZE,
        (msg_type << 4) | flags,
        (serialization << 4) | compression,
        0x00,
    ]
}

pub(super) fn gzip_compress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(data)
        .map_err(|e| format!("gzip compress: {e}"))?;
    encoder.finish().map_err(|e| format!("gzip finish: {e}"))
}

pub(super) fn gzip_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(data);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|e| format!("gzip decompress: {e}"))?;
    Ok(out)
}

pub(super) struct VolcengineConfigPacket<'a> {
    pub app_id: &'a str,
    pub access_token: &'a str,
    pub resource_id: &'a str,
    pub mode: VolcengineMode,
    pub language: Option<&'a str>,
    pub hotwords: &'a [String],
    pub request_id: String,
}

pub(super) fn build_volcengine_config_packet(
    params: VolcengineConfigPacket<'_>,
) -> Result<Vec<u8>, String> {
    let lang = match params.language {
        Some("auto") | None => "zh-CN",
        Some(language) => language,
    };
    let mut audio_payload = serde_json::json!({
        "format": "pcm",
        "codec": "raw",
        "rate": 16000,
        "bits": 16,
        "channel": 1,
    });
    if params.mode.supports_language() {
        audio_payload["language"] = serde_json::Value::String(lang.to_string());
    }

    let payload_app_id = if params.app_id.trim().is_empty() {
        "typefree"
    } else {
        params.app_id
    };

    let mut config_payload = serde_json::json!({
        "app": {
            "appid": payload_app_id,
            "cluster": params.resource_id,
            "token": params.access_token,
        },
        "user": { "uid": "typefree-user" },
        "request": {
            "reqid": params.request_id,
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
    if !params.hotwords.is_empty() {
        config_payload["context"] = serde_json::json!({
            "hotwords": params.hotwords
                .iter()
                .map(|word| serde_json::json!({ "word": word, "scale": 5.0 }))
                .collect::<Vec<_>>()
        });
    }

    build_volcengine_config_payload_packet(&config_payload)
}

fn build_volcengine_config_payload_packet(
    config_payload: &serde_json::Value,
) -> Result<Vec<u8>, String> {
    let json_bytes = serde_json::to_vec(config_payload).map_err(|e| e.to_string())?;
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
    Ok(packet)
}

pub(super) fn build_volcengine_audio_packet(chunk: &[u8], is_last: bool) -> Vec<u8> {
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
    audio_packet
}

pub(super) struct VolcengineServerError {
    pub message: String,
    pub raw_hex: String,
}

pub(super) struct VolcengineServerResponse {
    pub payload: serde_json::Value,
    pub text: String,
    pub audio_ms: u64,
    pub is_final: bool,
    pub is_definite: bool,
}

pub(super) enum VolcengineServerPacket {
    Ack,
    Error(VolcengineServerError),
    Response(VolcengineServerResponse),
    Ignore,
}

pub(super) fn decode_volcengine_server_packet(data: &[u8]) -> VolcengineServerPacket {
    if data.len() < 4 {
        return VolcengineServerPacket::Ignore;
    }

    let msg_type = (data[1] >> 4) & 0x0f;
    let msg_flags = data[1] & 0x0f;
    let compression = data[2] & 0x0f;
    let header_byte_len = (data[0] & 0x0f) as usize * 4;

    if msg_type == VOLC_MSG_SERVER_ACK {
        return VolcengineServerPacket::Ack;
    }

    if msg_type == VOLC_MSG_SERVER_ERROR {
        let raw_hex = data
            .iter()
            .take(128)
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(" ");
        return VolcengineServerPacket::Error(VolcengineServerError {
            message: volcengine_error_packet_to_string(data, header_byte_len),
            raw_hex,
        });
    }

    if msg_type != VOLC_MSG_FULL_SERVER_RESPONSE {
        return VolcengineServerPacket::Ignore;
    }

    let Some(raw_payload) = volcengine_response_payload(data, header_byte_len) else {
        return VolcengineServerPacket::Ignore;
    };
    let payload_bytes = if compression == VOLC_COMPRESS_GZIP {
        gzip_decompress(&raw_payload).unwrap_or(raw_payload)
    } else {
        raw_payload
    };

    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&payload_bytes) else {
        return VolcengineServerPacket::Ignore;
    };
    let text = volcengine_response_text(&payload).unwrap_or("").to_string();
    let audio_ms = payload
        .pointer("/audio_info/duration")
        .and_then(|value| value.as_u64())
        .unwrap_or_default();
    let is_definite = volcengine_response_is_definite(&payload);
    let is_final = msg_flags == VOLC_FLAGS_ASYNC_FINAL_RESPONSE
        || msg_flags == VOLC_FLAGS_NEGATIVE_SEQUENCE_LAST
        || is_definite;

    VolcengineServerPacket::Response(VolcengineServerResponse {
        payload,
        text,
        audio_ms,
        is_final,
        is_definite,
    })
}

#[derive(Clone, Copy)]
pub(super) enum VolcengineMode {
    SeedAsr2,
}

impl VolcengineMode {
    pub(super) fn from_model(_model: Option<&str>) -> Self {
        Self::SeedAsr2
    }

    pub(super) fn endpoint(self) -> &'static str {
        match self {
            Self::SeedAsr2 => "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::SeedAsr2 => "seed_asr_2",
        }
    }

    pub(super) fn supports_language(self) -> bool {
        false
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum VolcengineAuthMode {
    LegacyAppAccess,
    ApiKey,
}

impl VolcengineAuthMode {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::LegacyAppAccess => "legacy-app-access",
            Self::ApiKey => "api-key",
        }
    }
}

pub(super) fn volcengine_auth_modes(app_id: &str) -> Vec<VolcengineAuthMode> {
    if app_id.trim().is_empty() {
        vec![VolcengineAuthMode::ApiKey]
    } else {
        vec![
            VolcengineAuthMode::LegacyAppAccess,
            VolcengineAuthMode::ApiKey,
        ]
    }
}

pub(super) fn with_volcengine_auth_headers(
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

pub(super) fn build_volcengine_ws_request(
    ws_url: &str,
    resource_id: &str,
    connect_id: &str,
    app_id: &str,
    access_token: &str,
    auth_mode: VolcengineAuthMode,
) -> Result<http::Request<()>, String> {
    let uri: http::Uri = ws_url
        .parse()
        .map_err(|e: http::uri::InvalidUri| e.to_string())?;
    let host = uri.host().unwrap_or("openspeech.bytedance.com");
    let request_builder = http::Request::builder()
        .uri(ws_url)
        .header("Host", host)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header(
            "Sec-WebSocket-Key",
            tokio_tungstenite::tungstenite::handshake::client::generate_key(),
        )
        .header("X-Api-Resource-Id", resource_id)
        .header("X-Api-Connect-Id", connect_id);

    with_volcengine_auth_headers(request_builder, app_id, access_token, auth_mode)
        .body(())
        .map_err(|e| format!("Failed to build WS request: {e}"))
}

pub(super) fn should_retry_volcengine_auth(error: &str, mode: VolcengineAuthMode) -> bool {
    mode == VolcengineAuthMode::LegacyAppAccess
        && (error.contains("401") || error.to_ascii_lowercase().contains("unauthorized"))
}

pub(super) fn normalize_volcengine_resource_id(resource_id: &str) -> String {
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

pub(super) fn normalize_volcengine_audio(audio_data: Vec<u8>) -> Result<Vec<u8>, String> {
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

pub(super) fn volcengine_pcm_duration_ms(audio_data: &[u8]) -> u64 {
    (audio_data.len() as u64).saturating_mul(1000) / 32_000
}

pub(super) fn volcengine_response_payload(data: &[u8], header_len: usize) -> Option<Vec<u8>> {
    if data.len() >= header_len + 8 {
        let payload_size =
            u32::from_be_bytes(data[header_len + 4..header_len + 8].try_into().ok()?) as usize;
        let payload_start = header_len + 8;
        if payload_size > 0 && data.len() >= payload_start + payload_size {
            return Some(data[payload_start..payload_start + payload_size].to_vec());
        }
    }

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

pub(super) fn volcengine_response_text(parsed: &serde_json::Value) -> Option<&str> {
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

pub(super) fn volcengine_response_is_definite(parsed: &serde_json::Value) -> bool {
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

pub(super) fn volcengine_error_packet_to_string(data: &[u8], header_byte_len: usize) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_pcm_16k_mono(payload: &[u8], sample_rate: u32) -> Vec<u8> {
        let mut wav = Vec::new();
        let fmt_chunk_size = 16u32;
        let data_chunk_size = payload.len() as u32;
        let riff_size = 4 + 8 + fmt_chunk_size + 8 + data_chunk_size;

        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&riff_size.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&fmt_chunk_size.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_chunk_size.to_le_bytes());
        wav.extend_from_slice(payload);
        wav
    }

    fn config_payload_from_packet(packet: &[u8]) -> serde_json::Value {
        assert_eq!(
            &packet[0..4],
            &volc_build_header(
                VOLC_MSG_FULL_CLIENT_REQUEST,
                VOLC_FLAGS_NONE,
                VOLC_SERIAL_JSON,
                VOLC_COMPRESS_GZIP
            )
        );
        let payload_size = u32::from_be_bytes(packet[4..8].try_into().unwrap()) as usize;
        assert_eq!(payload_size, packet.len() - 8);
        let payload_bytes = gzip_decompress(&packet[8..]).expect("decompress config packet");
        serde_json::from_slice(&payload_bytes).expect("config json")
    }

    fn server_response_packet(payload: &serde_json::Value, flags: u8, compression: u8) -> Vec<u8> {
        let payload_bytes = serde_json::to_vec(payload).expect("response json");
        let payload_bytes = if compression == VOLC_COMPRESS_GZIP {
            gzip_compress(&payload_bytes).expect("compress response")
        } else {
            payload_bytes
        };
        let mut packet = volc_build_header(
            VOLC_MSG_FULL_SERVER_RESPONSE,
            flags,
            VOLC_SERIAL_JSON,
            compression,
        )
        .to_vec();
        packet.extend_from_slice(&1u32.to_be_bytes());
        packet.extend_from_slice(&(payload_bytes.len() as u32).to_be_bytes());
        packet.extend_from_slice(&payload_bytes);
        packet
    }

    #[test]
    fn builds_headers_and_round_trips_gzip() {
        assert_eq!(
            volc_build_header(
                VOLC_MSG_FULL_CLIENT_REQUEST,
                VOLC_FLAGS_NONE,
                VOLC_SERIAL_JSON,
                VOLC_COMPRESS_GZIP,
            ),
            [0x11, 0x10, 0x11, 0x00]
        );

        let input = br#"{"hello":"world"}"#;
        let compressed = gzip_compress(input).expect("compress");
        assert_ne!(compressed, input);
        assert_eq!(gzip_decompress(&compressed).expect("decompress"), input);
    }

    #[test]
    fn builds_config_and_audio_packets() {
        let hotwords = vec!["TypeFree".to_string(), "Doubao".to_string()];
        let packet = build_volcengine_config_packet(VolcengineConfigPacket {
            app_id: "",
            access_token: "token",
            resource_id: "volc.seedasr.sauc.duration",
            mode: VolcengineMode::SeedAsr2,
            language: Some("en-US"),
            hotwords: &hotwords,
            request_id: "req-1".to_string(),
        })
        .expect("config packet");
        let payload = config_payload_from_packet(&packet);

        assert_eq!(payload["app"]["appid"], "typefree");
        assert_eq!(payload["app"]["cluster"], "volc.seedasr.sauc.duration");
        assert_eq!(payload["app"]["token"], "token");
        assert_eq!(payload["request"]["reqid"], "req-1");
        assert_eq!(payload["audio"]["format"], "pcm");
        assert!(payload["audio"].get("language").is_none());
        assert_eq!(payload["context"]["hotwords"][0]["word"], "TypeFree");
        assert_eq!(payload["context"]["hotwords"][0]["scale"], 5.0);
        assert_eq!(payload["context"]["hotwords"][1]["word"], "Doubao");

        let audio = build_volcengine_audio_packet(&[0x01, 0x02, 0x03], false);
        assert_eq!(&audio[0..4], &[0x11, 0x20, 0x00, 0x00]);
        assert_eq!(&audio[4..8], &3u32.to_be_bytes());
        assert_eq!(&audio[8..], &[0x01, 0x02, 0x03]);

        let finish = build_volcengine_audio_packet(&[], true);
        assert_eq!(&finish[0..4], &[0x11, 0x22, 0x00, 0x00]);
        assert_eq!(&finish[4..8], &0u32.to_be_bytes());
        assert_eq!(finish.len(), 8);
    }

    #[test]
    fn normalizes_resource_and_auth_modes() {
        assert_eq!(
            normalize_volcengine_resource_id("volc.custom.resource"),
            "volc.custom.resource"
        );
        assert_eq!(
            normalize_volcengine_resource_id("SeedASR 2.0"),
            "volc.seedasr.sauc.duration"
        );
        assert_eq!(
            normalize_volcengine_resource_id("legacy bigasr"),
            "volc.bigasr.sauc.duration"
        );

        assert_eq!(volcengine_auth_modes(""), vec![VolcengineAuthMode::ApiKey]);
        assert_eq!(
            volcengine_auth_modes("app-id"),
            vec![
                VolcengineAuthMode::LegacyAppAccess,
                VolcengineAuthMode::ApiKey
            ]
        );
        assert!(should_retry_volcengine_auth(
            "401 Unauthorized",
            VolcengineAuthMode::LegacyAppAccess
        ));
        assert!(!should_retry_volcengine_auth(
            "401 Unauthorized",
            VolcengineAuthMode::ApiKey
        ));
    }

    #[test]
    fn builds_ws_requests_for_auth_modes() {
        let legacy = build_volcengine_ws_request(
            "wss://example.com/api/v3",
            "volc.seedasr.sauc.duration",
            "connect-1",
            "app-id",
            "token",
            VolcengineAuthMode::LegacyAppAccess,
        )
        .expect("legacy request");
        assert_eq!(legacy.uri().to_string(), "wss://example.com/api/v3");
        assert_eq!(legacy.headers()["Host"].to_str().unwrap(), "example.com");
        assert_eq!(
            legacy.headers()["X-Api-Resource-Id"].to_str().unwrap(),
            "volc.seedasr.sauc.duration"
        );
        assert_eq!(
            legacy.headers()["X-Api-Connect-Id"].to_str().unwrap(),
            "connect-1"
        );
        assert_eq!(
            legacy.headers()["X-Api-App-Key"].to_str().unwrap(),
            "app-id"
        );
        assert_eq!(
            legacy.headers()["X-Api-Access-Key"].to_str().unwrap(),
            "token"
        );
        assert!(legacy.headers().get("X-Api-Key").is_none());

        let api_key = build_volcengine_ws_request(
            "wss://example.com/api/v3",
            "volc.seedasr.sauc.duration",
            "connect-2",
            "",
            "token",
            VolcengineAuthMode::ApiKey,
        )
        .expect("api key request");
        assert_eq!(api_key.headers()["X-Api-Key"].to_str().unwrap(), "token");
        assert!(api_key.headers().get("X-Api-App-Key").is_none());
        assert!(api_key.headers().get("X-Api-Access-Key").is_none());
    }

    #[test]
    fn normalizes_pcm_audio_and_duration() {
        let pcm = vec![0x01, 0x02, 0x03, 0x04];
        assert_eq!(normalize_volcengine_audio(pcm.clone()).unwrap(), pcm);

        let wav = wav_pcm_16k_mono(&[0x11, 0x22, 0x33, 0x44], 16_000);
        assert_eq!(
            normalize_volcengine_audio(wav).unwrap(),
            vec![0x11, 0x22, 0x33, 0x44]
        );

        let invalid = wav_pcm_16k_mono(&[0x11, 0x22], 48_000);
        let error = normalize_volcengine_audio(invalid).expect_err("invalid sample rate");
        assert!(error.contains("sample_rate=Some(48000)"));

        assert_eq!(volcengine_pcm_duration_ms(&vec![0; 32_000]), 1000);
    }

    #[test]
    fn parses_response_payload_text_and_definite_status() {
        let payload = b"hello";
        let mut packet = vec![0u8; 8];
        packet.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        packet.extend_from_slice(payload);
        assert_eq!(
            volcengine_response_payload(&packet, 4).expect("payload"),
            payload
        );

        let parsed = serde_json::json!({
            "result": [{
                "text": "hello",
                "utterances": [{ "definite": true }]
            }]
        });
        assert_eq!(volcengine_response_text(&parsed), Some("hello"));
        assert!(volcengine_response_is_definite(&parsed));

        let fallback = serde_json::json!({ "text": "fallback" });
        assert_eq!(volcengine_response_text(&fallback), Some("fallback"));
        assert!(!volcengine_response_is_definite(&fallback));
    }

    #[test]
    fn decodes_server_packets() {
        let ack = volc_build_header(VOLC_MSG_SERVER_ACK, VOLC_FLAGS_NONE, 0, 0);
        assert!(matches!(
            decode_volcengine_server_packet(&ack),
            VolcengineServerPacket::Ack
        ));

        let payload = serde_json::json!({
            "result": [{
                "text": "hello",
                "utterances": [{ "definite": true }]
            }],
            "audio_info": { "duration": 1234 }
        });
        let packet = server_response_packet(&payload, VOLC_FLAGS_NONE, VOLC_COMPRESS_GZIP);
        let VolcengineServerPacket::Response(response) = decode_volcengine_server_packet(&packet)
        else {
            panic!("expected response packet");
        };
        assert_eq!(response.text, "hello");
        assert_eq!(response.audio_ms, 1234);
        assert!(response.is_definite);
        assert!(response.is_final);
        assert_eq!(response.payload["audio_info"]["duration"], 1234);

        let partial = serde_json::json!({
            "result": { "text": "partial", "utterances": [{ "definite": false }] }
        });
        let packet = server_response_packet(&partial, VOLC_FLAGS_NONE, 0);
        let VolcengineServerPacket::Response(response) = decode_volcengine_server_packet(&packet)
        else {
            panic!("expected partial response packet");
        };
        assert_eq!(response.text, "partial");
        assert_eq!(response.audio_ms, 0);
        assert!(!response.is_definite);
        assert!(!response.is_final);

        let ignored = [0x11, 0x20, 0x00, 0x00];
        assert!(matches!(
            decode_volcengine_server_packet(&ignored),
            VolcengineServerPacket::Ignore
        ));
    }

    #[test]
    fn formats_error_packets() {
        let message = b"bad token";
        let mut packet = vec![0u8; 4];
        packet.extend_from_slice(&401u32.to_be_bytes());
        packet.extend_from_slice(&(message.len() as u32).to_be_bytes());
        packet.extend_from_slice(message);

        assert_eq!(
            volcengine_error_packet_to_string(&packet, 4),
            "Volcengine error 401: bad token"
        );

        let mut packet = volc_build_header(VOLC_MSG_SERVER_ERROR, VOLC_FLAGS_NONE, 0, 0).to_vec();
        packet.extend_from_slice(&401u32.to_be_bytes());
        packet.extend_from_slice(&(message.len() as u32).to_be_bytes());
        packet.extend_from_slice(message);
        let VolcengineServerPacket::Error(error) = decode_volcengine_server_packet(&packet) else {
            panic!("expected error packet");
        };
        assert_eq!(error.message, "Volcengine error 401: bad token");
        assert!(error.raw_hex.starts_with("11 f0 00 00"));
    }
}
