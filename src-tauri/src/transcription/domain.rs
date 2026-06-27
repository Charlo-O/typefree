use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::command_error::{CommandError, CommandResult};

pub(crate) const TRANSCRIPT_EVENT_NAME: &str = "transcript-event";
pub(crate) const BATCH_TRANSCRIPT_EVENT_NAME: &str = "batch-transcript";
pub(crate) const OPENAI_REALTIME_TRANSCRIPT_EVENT_NAME: &str = "openai-realtime-transcript";
pub(crate) const VOLCENGINE_STREAMING_TRANSCRIPT_EVENT_NAME: &str =
    "volcengine-streaming-transcript";

pub(crate) struct BatchTranscriptionRequest {
    pub audio_data: Vec<u8>,
    pub context: BatchProviderContext,
    pub model: Option<String>,
    pub language: Option<String>,
    pub prompt: Option<String>,
    pub session_id: Option<String>,
    pub endpoint_override: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AudioPartMetadata {
    pub extension: &'static str,
    pub mime_type: &'static str,
}

pub(crate) fn detect_audio_part_metadata(
    audio_data: &[u8],
    fallback_extension: &'static str,
) -> AudioPartMetadata {
    if audio_data.len() >= 12 && &audio_data[0..4] == b"RIFF" && &audio_data[8..12] == b"WAVE" {
        return AudioPartMetadata {
            extension: "wav",
            mime_type: "audio/wav",
        };
    }
    if audio_data.len() >= 4 && &audio_data[0..4] == b"OggS" {
        return AudioPartMetadata {
            extension: "ogg",
            mime_type: "audio/ogg",
        };
    }
    if audio_data.len() >= 3 && &audio_data[0..3] == b"ID3" {
        return AudioPartMetadata {
            extension: "mp3",
            mime_type: "audio/mpeg",
        };
    }
    if audio_data.len() >= 2 && audio_data[0] == 0xff && (audio_data[1] & 0xe0) == 0xe0 {
        return AudioPartMetadata {
            extension: "mp3",
            mime_type: "audio/mpeg",
        };
    }
    if audio_data.len() >= 12 && &audio_data[4..8] == b"ftyp" {
        return AudioPartMetadata {
            extension: "m4a",
            mime_type: "audio/mp4",
        };
    }
    if audio_data.len() >= 4 && audio_data[0..4] == [0x1a, 0x45, 0xdf, 0xa3] {
        return AudioPartMetadata {
            extension: "webm",
            mime_type: "audio/webm",
        };
    }

    match fallback_extension {
        "wav" => AudioPartMetadata {
            extension: "wav",
            mime_type: "audio/wav",
        },
        "ogg" => AudioPartMetadata {
            extension: "ogg",
            mime_type: "audio/ogg",
        },
        "mp3" => AudioPartMetadata {
            extension: "mp3",
            mime_type: "audio/mpeg",
        },
        "m4a" | "mp4" => AudioPartMetadata {
            extension: "m4a",
            mime_type: "audio/mp4",
        },
        _ => AudioPartMetadata {
            extension: "webm",
            mime_type: "audio/webm",
        },
    }
}

pub(crate) enum BatchProviderContext {
    ApiKey(String),
    Volcengine {
        app_id: String,
        access_token: String,
        resource_id: String,
        hotwords: Vec<String>,
    },
}

impl BatchProviderContext {
    pub(crate) fn api_key(api_key: String) -> Self {
        Self::ApiKey(api_key)
    }

    pub(crate) fn volcengine(
        app_id: String,
        access_token: String,
        resource_id: String,
        hotwords: Vec<String>,
    ) -> Self {
        Self::Volcengine {
            app_id,
            access_token,
            resource_id,
            hotwords,
        }
    }

    pub(crate) fn into_api_key(self, provider_id: &str) -> CommandResult<String> {
        match self {
            Self::ApiKey(api_key) => Ok(api_key),
            Self::Volcengine { .. } => Err(CommandError::configuration(format!(
                "{provider_id} provider received Volcengine credentials"
            ))),
        }
    }

    pub(crate) fn into_volcengine(self) -> CommandResult<(String, String, String, Vec<String>)> {
        match self {
            Self::Volcengine {
                app_id,
                access_token,
                resource_id,
                hotwords,
            } => Ok((app_id, access_token, resource_id, hotwords)),
            Self::ApiKey(_) => Err(CommandError::configuration(
                "Volcengine provider received API key credentials",
            )),
        }
    }
}

pub(crate) struct BatchTranscriptionResult {
    pub text: String,
    pub provider_id: &'static str,
}

impl BatchTranscriptionResult {
    pub(crate) fn new(provider_id: &'static str, text: String) -> Self {
        Self { text, provider_id }
    }
}

pub(crate) trait TranscriptionProvider {
    fn id(&self) -> &'static str;

    async fn transcribe(
        &self,
        request: BatchTranscriptionRequest,
    ) -> CommandResult<BatchTranscriptionResult>;
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscriptEvent {
    pub session_id: String,
    pub provider: &'static str,
    pub mode: &'static str,
    pub text: String,
    pub is_final: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_ms: Option<u64>,
    pub definite: bool,
}

impl TranscriptEvent {
    pub(crate) fn batch_final(provider: &'static str, session_id: String, text: String) -> Self {
        Self {
            session_id,
            provider,
            mode: "batch",
            text,
            is_final: true,
            delta: None,
            item_id: None,
            audio_ms: None,
            definite: true,
        }
    }

    pub(crate) fn streaming(
        provider: &'static str,
        session_id: String,
        text: String,
        is_final: bool,
    ) -> Self {
        Self {
            session_id,
            provider,
            mode: "streaming",
            text,
            is_final,
            delta: None,
            item_id: None,
            audio_ms: None,
            definite: false,
        }
    }

    pub(crate) fn realtime_delta(
        provider: &'static str,
        session_id: String,
        text: String,
        delta: String,
        item_id: Option<String>,
    ) -> Self {
        Self {
            session_id,
            provider,
            mode: "realtime",
            text,
            is_final: false,
            delta: Some(delta),
            item_id,
            audio_ms: None,
            definite: false,
        }
    }

    pub(crate) fn realtime_final(
        provider: &'static str,
        session_id: String,
        text: String,
        item_id: Option<String>,
    ) -> Self {
        Self {
            session_id,
            provider,
            mode: "realtime",
            text,
            is_final: true,
            delta: None,
            item_id,
            audio_ms: None,
            definite: true,
        }
    }

    pub(crate) fn with_audio_ms(mut self, audio_ms: Option<u64>) -> Self {
        self.audio_ms = audio_ms;
        self
    }

    pub(crate) fn with_definite(mut self, definite: bool) -> Self {
        self.definite = definite;
        self
    }
}

pub(crate) fn emit_transcript_event(
    app: &AppHandle,
    legacy_event_name: &'static str,
    event: TranscriptEvent,
) {
    let _ = app.emit(TRANSCRIPT_EVENT_NAME, event.clone());
    let _ = app.emit(legacy_event_name, event);
}

#[cfg(test)]
mod tests {
    use crate::commands::command_error::CommandErrorKind;

    use super::*;

    #[test]
    fn credential_context_mismatch_returns_configuration_errors() {
        let error = BatchProviderContext::volcengine(
            "app".to_string(),
            "token".to_string(),
            "resource".to_string(),
            vec!["hotword".to_string()],
        )
        .into_api_key("openai")
        .expect_err("wrong credential context should fail");
        assert_eq!(error.kind, CommandErrorKind::Configuration);
        assert!(!error.retryable);

        let error = BatchProviderContext::api_key("sk-test".to_string())
            .into_volcengine()
            .expect_err("wrong credential context should fail");
        assert_eq!(error.kind, CommandErrorKind::Configuration);
        assert!(!error.retryable);
    }

    #[test]
    fn detects_audio_part_metadata_from_container_bytes() {
        assert_eq!(
            detect_audio_part_metadata(b"RIFF\x24\x00\x00\x00WAVEfmt ", "webm"),
            AudioPartMetadata {
                extension: "wav",
                mime_type: "audio/wav"
            }
        );
        assert_eq!(
            detect_audio_part_metadata(b"OggS\x00\x02", "webm"),
            AudioPartMetadata {
                extension: "ogg",
                mime_type: "audio/ogg"
            }
        );
        assert_eq!(
            detect_audio_part_metadata(&[0x1a, 0x45, 0xdf, 0xa3, 0x00], "wav"),
            AudioPartMetadata {
                extension: "webm",
                mime_type: "audio/webm"
            }
        );
        assert_eq!(
            detect_audio_part_metadata(b"unknown", "mp3"),
            AudioPartMetadata {
                extension: "mp3",
                mime_type: "audio/mpeg"
            }
        );
    }

    #[test]
    fn transcript_event_factories_serialize_shared_contract() {
        let streaming = TranscriptEvent::streaming(
            "volcengine",
            "session-a".to_string(),
            "hello".to_string(),
            true,
        )
        .with_audio_ms(Some(320))
        .with_definite(true);
        let streaming_json = serde_json::to_value(&streaming).unwrap();
        assert_eq!(streaming_json["sessionId"], "session-a");
        assert_eq!(streaming_json["provider"], "volcengine");
        assert_eq!(streaming_json["mode"], "streaming");
        assert_eq!(streaming_json["text"], "hello");
        assert_eq!(streaming_json["isFinal"], true);
        assert_eq!(streaming_json["audioMs"], 320);
        assert_eq!(streaming_json["definite"], true);
        assert!(streaming_json.get("delta").is_none());
        assert!(streaming_json.get("itemId").is_none());

        let batch = TranscriptEvent::batch_final(
            "zai",
            "session-batch".to_string(),
            "batch text".to_string(),
        );
        let batch_json = serde_json::to_value(&batch).unwrap();
        assert_eq!(batch_json["sessionId"], "session-batch");
        assert_eq!(batch_json["provider"], "zai");
        assert_eq!(batch_json["mode"], "batch");
        assert_eq!(batch_json["text"], "batch text");
        assert_eq!(batch_json["isFinal"], true);
        assert_eq!(batch_json["definite"], true);
        assert!(batch_json.get("delta").is_none());
        assert!(batch_json.get("itemId").is_none());

        let realtime_delta = TranscriptEvent::realtime_delta(
            "openai",
            "session-b".to_string(),
            "hel".to_string(),
            "hel".to_string(),
            Some("item-1".to_string()),
        );
        let realtime_delta_json = serde_json::to_value(&realtime_delta).unwrap();
        assert_eq!(realtime_delta_json["mode"], "realtime");
        assert_eq!(realtime_delta_json["isFinal"], false);
        assert_eq!(realtime_delta_json["delta"], "hel");
        assert_eq!(realtime_delta_json["itemId"], "item-1");
        assert_eq!(realtime_delta_json["definite"], false);

        let realtime_final = TranscriptEvent::realtime_final(
            "openai",
            "session-b".to_string(),
            "hello".to_string(),
            Some("item-1".to_string()),
        );
        let realtime_final_json = serde_json::to_value(&realtime_final).unwrap();
        assert_eq!(realtime_final_json["mode"], "realtime");
        assert_eq!(realtime_final_json["isFinal"], true);
        assert!(realtime_final_json.get("delta").is_none());
        assert_eq!(realtime_final_json["itemId"], "item-1");
        assert_eq!(realtime_final_json["definite"], true);
    }

    #[test]
    fn exposes_unified_and_legacy_transcript_event_names() {
        assert_eq!(TRANSCRIPT_EVENT_NAME, "transcript-event");
        assert_eq!(BATCH_TRANSCRIPT_EVENT_NAME, "batch-transcript");
        assert_eq!(
            OPENAI_REALTIME_TRANSCRIPT_EVENT_NAME,
            "openai-realtime-transcript"
        );
        assert_eq!(
            VOLCENGINE_STREAMING_TRANSCRIPT_EVENT_NAME,
            "volcengine-streaming-transcript"
        );
    }
}
