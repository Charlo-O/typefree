use serde::{Deserialize, Serialize};

/// Runtime families that can execute a local ASR model.
///
/// This is deliberately a closed list for the first contract version, while
/// `ExternalCommand` keeps the protocol extensible for user-installed engines.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LocalAsrRuntime {
    WhisperCpp,
    SherpaOnnx,
    R2t2Llama,
    ExternalCommand,
    OpenAiCompatible,
}

/// Model container formats currently supported by the local ASR contract.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LocalAsrModelFormat {
    Gguf,
    Onnx,
    SafeTensors,
    Custom,
}

/// A model plus the runtime metadata needed to select an adapter.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAsrModelManifest {
    pub id: String,
    pub display_name: String,
    pub runtime: LocalAsrRuntime,
    pub format: LocalAsrModelFormat,
    pub model_path: String,
    #[serde(default)]
    pub projector_path: Option<String>,
    #[serde(default)]
    pub executable_path: Option<String>,
    #[serde(default)]
    pub supports_streaming: bool,
    #[serde(default)]
    pub languages: Vec<String>,
}

impl LocalAsrModelManifest {
    /// Validate user or downloaded manifest data before a runtime is started.
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() {
            return Err("local ASR model id cannot be empty".to_string());
        }
        if self.display_name.trim().is_empty() {
            return Err("local ASR model display name cannot be empty".to_string());
        }
        if self.model_path.trim().is_empty()
            && !matches!(
                self.runtime,
                LocalAsrRuntime::ExternalCommand | LocalAsrRuntime::WhisperCpp
            )
        {
            return Err("local ASR model path cannot be empty".to_string());
        }
        if matches!(self.runtime, LocalAsrRuntime::R2t2Llama)
            && self
                .projector_path
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            return Err("R2T2/llama.cpp models require a projector path".to_string());
        }
        if matches!(self.runtime, LocalAsrRuntime::ExternalCommand)
            && self
                .executable_path
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            return Err("external local ASR runtime requires an executable path".to_string());
        }
        Ok(())
    }
}

/// Stable input contract for a local batch or streaming adapter.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAsrRequest {
    pub audio_data: Vec<u8>,
    pub model: LocalAsrModelManifest,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
}

impl LocalAsrRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.audio_data.is_empty() {
            return Err("local ASR audio payload cannot be empty".to_string());
        }
        self.model.validate()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gguf_manifest() -> LocalAsrModelManifest {
        LocalAsrModelManifest {
            id: "confucius4-r2t2-q8".to_string(),
            display_name: "Confucius4 R2T2 Q8".to_string(),
            runtime: LocalAsrRuntime::R2t2Llama,
            format: LocalAsrModelFormat::Gguf,
            model_path: "models/confucius.gguf".to_string(),
            projector_path: Some("models/mmproj.gguf".to_string()),
            executable_path: None,
            supports_streaming: true,
            languages: vec!["zh".to_string(), "en".to_string()],
        }
    }

    #[test]
    fn r2t2_manifest_requires_projector() {
        let mut manifest = gguf_manifest();
        manifest.projector_path = None;
        let error = manifest.validate().expect_err("projector is required");
        assert!(error.contains("projector"));
    }

    #[test]
    fn external_runtime_requires_executable() {
        let mut manifest = gguf_manifest();
        manifest.runtime = LocalAsrRuntime::ExternalCommand;
        manifest.projector_path = None;
        let error = manifest.validate().expect_err("executable is required");
        assert!(error.contains("executable"));
    }

    #[test]
    fn request_rejects_empty_audio() {
        let request = LocalAsrRequest {
            audio_data: Vec::new(),
            model: gguf_manifest(),
            language: Some("zh".to_string()),
            session_id: None,
        };
        let error = request.validate().expect_err("empty audio is invalid");
        assert!(error.contains("audio"));
    }

    #[test]
    fn manifest_round_trips_as_camel_case_json() {
        let json = serde_json::to_string(&gguf_manifest()).expect("serialize manifest");
        assert!(json.contains("displayName"));
        assert!(json.contains("projectorPath"));
        let restored: LocalAsrModelManifest =
            serde_json::from_str(&json).expect("deserialize manifest");
        assert_eq!(restored, gguf_manifest());
    }
}
