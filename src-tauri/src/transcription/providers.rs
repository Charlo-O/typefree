mod assemblyai;
mod groq;
mod openai;
mod volcengine;
mod zai;

use assemblyai::AssemblyAIProvider;
use groq::GroqProvider;
use openai::OpenAIProvider;
use volcengine::VolcengineProvider;
use zai::ZaiProvider;

use crate::commands::command_error::CommandResult;

use super::domain::{BatchTranscriptionRequest, BatchTranscriptionResult, TranscriptionProvider};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BatchProvider {
    AssemblyAI,
    OpenAI,
    Groq,
    Zai,
    Volcengine,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct TranscriptionProviderCapabilities {
    pub supports_batch: bool,
    pub supports_streaming: bool,
    pub supports_realtime: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct BatchProviderCatalogEntry {
    provider: BatchProvider,
    pub id: &'static str,
    pub name: &'static str,
    pub requires_key: bool,
    pub default_base_url: &'static str,
    pub supports_endpoint_override: bool,
    pub capabilities: TranscriptionProviderCapabilities,
}

const BATCH_PROVIDER_CATALOG: [BatchProviderCatalogEntry; 5] = [
    BatchProviderCatalogEntry {
        provider: BatchProvider::AssemblyAI,
        id: "assemblyai",
        name: "AssemblyAI",
        requires_key: true,
        default_base_url: "https://api.assemblyai.com/v2",
        supports_endpoint_override: true,
        capabilities: TranscriptionProviderCapabilities {
            supports_batch: true,
            supports_streaming: false,
            supports_realtime: false,
        },
    },
    BatchProviderCatalogEntry {
        provider: BatchProvider::OpenAI,
        id: "openai",
        name: "OpenAI Whisper",
        requires_key: true,
        default_base_url: "https://api.openai.com/v1",
        supports_endpoint_override: true,
        capabilities: TranscriptionProviderCapabilities {
            supports_batch: true,
            supports_streaming: false,
            supports_realtime: true,
        },
    },
    BatchProviderCatalogEntry {
        provider: BatchProvider::Groq,
        id: "groq",
        name: "Groq",
        requires_key: true,
        default_base_url: "https://api.groq.com/openai/v1",
        supports_endpoint_override: true,
        capabilities: TranscriptionProviderCapabilities {
            supports_batch: true,
            supports_streaming: false,
            supports_realtime: false,
        },
    },
    BatchProviderCatalogEntry {
        provider: BatchProvider::Zai,
        id: "zai",
        name: "Z.ai (Zhipu GLM ASR)",
        requires_key: true,
        default_base_url: "https://api.z.ai/api",
        supports_endpoint_override: true,
        capabilities: TranscriptionProviderCapabilities {
            supports_batch: true,
            supports_streaming: false,
            supports_realtime: false,
        },
    },
    BatchProviderCatalogEntry {
        provider: BatchProvider::Volcengine,
        id: "volcengine",
        name: "Volcengine (豆包)",
        requires_key: true,
        default_base_url: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
        supports_endpoint_override: false,
        capabilities: TranscriptionProviderCapabilities {
            supports_batch: true,
            supports_streaming: true,
            supports_realtime: false,
        },
    },
];

pub(crate) fn batch_provider_catalog() -> &'static [BatchProviderCatalogEntry] {
    &BATCH_PROVIDER_CATALOG
}

pub(crate) fn provider_default_base_url(provider: BatchProvider) -> &'static str {
    provider.catalog_entry().default_base_url
}

fn append_provider_path(provider: BatchProvider, path: &str) -> String {
    format!(
        "{}{}",
        provider_default_base_url(provider).trim_end_matches('/'),
        path
    )
}

/// Default request URL used by batch adapters.
///
/// AssemblyAI returns its API v2 base because the adapter derives upload and
/// transcript subpaths from it. Single-call providers return their final
/// transcription endpoint.
pub(crate) fn provider_default_batch_url(provider: BatchProvider) -> String {
    match provider {
        BatchProvider::AssemblyAI | BatchProvider::Volcengine => {
            provider_default_base_url(provider)
                .trim_end_matches('/')
                .to_string()
        }
        BatchProvider::OpenAI | BatchProvider::Groq => {
            append_provider_path(provider, "/audio/transcriptions")
        }
        BatchProvider::Zai => append_provider_path(provider, "/paas/v4/audio/transcriptions"),
    }
}

pub(crate) fn provider_batch_url(
    provider: BatchProvider,
    endpoint_override: Option<String>,
) -> String {
    endpoint_override.unwrap_or_else(|| provider_default_batch_url(provider))
}

pub(crate) enum BatchProviderCredentials {
    ApiKey(&'static str),
    Volcengine {
        app_id_key: &'static str,
        access_token_key: &'static str,
        resource_id: &'static str,
    },
}

impl BatchProvider {
    pub fn from_id(provider: &str) -> Option<Self> {
        batch_provider_catalog()
            .iter()
            .find(|entry| entry.id == provider)
            .map(|entry| entry.provider)
    }

    pub fn credentials(self) -> BatchProviderCredentials {
        match self {
            Self::AssemblyAI => BatchProviderCredentials::ApiKey("ASSEMBLYAI_API_KEY"),
            Self::OpenAI => BatchProviderCredentials::ApiKey("OPENAI_API_KEY"),
            Self::Groq => BatchProviderCredentials::ApiKey("GROQ_API_KEY"),
            Self::Zai => BatchProviderCredentials::ApiKey("ZAI_API_KEY"),
            Self::Volcengine => BatchProviderCredentials::Volcengine {
                app_id_key: "VOLCENGINE_APP_ID",
                access_token_key: "VOLCENGINE_ACCESS_TOKEN",
                resource_id: "volc.seedasr.sauc.duration",
            },
        }
    }

    pub fn id(self) -> &'static str {
        self.catalog_entry().id
    }

    pub fn supports_streaming(self) -> bool {
        self.catalog_entry().capabilities.supports_streaming
    }

    pub fn supports_realtime(self) -> bool {
        self.catalog_entry().capabilities.supports_realtime
    }

    pub fn catalog_entry(self) -> BatchProviderCatalogEntry {
        *batch_provider_catalog()
            .iter()
            .find(|entry| entry.provider == self)
            .expect("BatchProvider must have catalog metadata")
    }

    pub fn timeout_message(self) -> &'static str {
        match self {
            Self::Volcengine => "Volcengine transcription timed out after 60 seconds",
            _ => "Transcription timed out after 60 seconds",
        }
    }

    pub async fn transcribe(
        self,
        request: BatchTranscriptionRequest,
    ) -> CommandResult<BatchTranscriptionResult> {
        match self {
            Self::AssemblyAI => AssemblyAIProvider.transcribe(request).await,
            Self::OpenAI => OpenAIProvider.transcribe(request).await,
            Self::Groq => GroqProvider.transcribe(request).await,
            Self::Zai => ZaiProvider.transcribe(request).await,
            Self::Volcengine => VolcengineProvider.transcribe(request).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_batch_provider_metadata() {
        let catalog = batch_provider_catalog();
        assert_eq!(
            catalog.iter().map(|entry| entry.id).collect::<Vec<_>>(),
            vec!["assemblyai", "openai", "groq", "zai", "volcengine"]
        );
        assert!(catalog.iter().all(|entry| entry.requires_key));
        assert!(catalog
            .iter()
            .all(|entry| entry.capabilities.supports_batch));
        assert_eq!(
            catalog
                .iter()
                .filter(|entry| entry.capabilities.supports_streaming)
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec!["volcengine"]
        );
        assert_eq!(
            catalog
                .iter()
                .filter(|entry| entry.capabilities.supports_realtime)
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec!["openai"]
        );

        let providers = [
            (
                "assemblyai",
                BatchProvider::AssemblyAI,
                "AssemblyAI",
                "ASSEMBLYAI_API_KEY",
                "Transcription timed out after 60 seconds",
                "https://api.assemblyai.com/v2",
            ),
            (
                "openai",
                BatchProvider::OpenAI,
                "OpenAI Whisper",
                "OPENAI_API_KEY",
                "Transcription timed out after 60 seconds",
                "https://api.openai.com/v1",
            ),
            (
                "groq",
                BatchProvider::Groq,
                "Groq",
                "GROQ_API_KEY",
                "Transcription timed out after 60 seconds",
                "https://api.groq.com/openai/v1",
            ),
            (
                "zai",
                BatchProvider::Zai,
                "Z.ai (Zhipu GLM ASR)",
                "ZAI_API_KEY",
                "Transcription timed out after 60 seconds",
                "https://api.z.ai/api",
            ),
        ];

        for (provider_id, provider, display_name, key, timeout_message, default_base_url) in
            providers
        {
            let mapped = BatchProvider::from_id(provider_id).expect("provider should map");
            let catalog_entry = provider.catalog_entry();
            assert_eq!(mapped, provider);
            assert_eq!(mapped.id(), provider_id);
            assert_eq!(provider.id(), provider_id);
            assert_eq!(catalog_entry.id, provider_id);
            assert_eq!(catalog_entry.name, display_name);
            assert!(catalog_entry.requires_key);
            assert_eq!(catalog_entry.default_base_url, default_base_url);
            assert_eq!(provider_default_base_url(provider), default_base_url);
            assert!(catalog_entry.supports_endpoint_override);
            assert!(catalog_entry.capabilities.supports_batch);
            let expected_default_batch_url = match provider {
                BatchProvider::AssemblyAI => default_base_url.to_string(),
                BatchProvider::OpenAI | BatchProvider::Groq => {
                    format!("{default_base_url}/audio/transcriptions")
                }
                BatchProvider::Zai => {
                    format!("{default_base_url}/paas/v4/audio/transcriptions")
                }
                BatchProvider::Volcengine => unreachable!("Volcengine tested separately"),
            };
            assert_eq!(
                provider_default_batch_url(provider),
                expected_default_batch_url
            );
            assert_eq!(
                provider_batch_url(provider, None),
                expected_default_batch_url
            );
            assert_eq!(
                provider_batch_url(
                    provider,
                    Some("https://proxy.example.test/transcription".to_string())
                ),
                "https://proxy.example.test/transcription"
            );
            assert_eq!(provider.timeout_message(), timeout_message);
            match provider.credentials() {
                BatchProviderCredentials::ApiKey(actual_key) => assert_eq!(actual_key, key),
                BatchProviderCredentials::Volcengine { .. } => {
                    panic!("expected API key credentials")
                }
            }
        }

        let volcengine = BatchProvider::from_id("volcengine").expect("provider should map");
        assert_eq!(volcengine.id(), "volcengine");
        let volcengine_catalog_entry = volcengine.catalog_entry();
        assert_eq!(volcengine_catalog_entry.name, "Volcengine (豆包)");
        assert!(volcengine_catalog_entry.requires_key);
        assert_eq!(
            volcengine_catalog_entry.default_base_url,
            "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
        );
        assert_eq!(
            provider_default_base_url(volcengine),
            volcengine_catalog_entry.default_base_url
        );
        assert_eq!(
            provider_default_batch_url(volcengine),
            volcengine_catalog_entry.default_base_url
        );
        assert!(!volcengine_catalog_entry.supports_endpoint_override);
        assert!(volcengine.supports_streaming());
        assert!(!volcengine.supports_realtime());
        assert!(BatchProvider::OpenAI.supports_realtime());
        assert!(!BatchProvider::OpenAI.supports_streaming());
        assert_eq!(
            volcengine.timeout_message(),
            "Volcengine transcription timed out after 60 seconds"
        );
        match volcengine.credentials() {
            BatchProviderCredentials::Volcengine {
                app_id_key,
                access_token_key,
                resource_id,
            } => {
                assert_eq!(app_id_key, "VOLCENGINE_APP_ID");
                assert_eq!(access_token_key, "VOLCENGINE_ACCESS_TOKEN");
                assert_eq!(resource_id, "volc.seedasr.sauc.duration");
            }
            BatchProviderCredentials::ApiKey(_) => panic!("expected Volcengine credentials"),
        }

        assert!(BatchProvider::from_id("unknown").is_none());
    }
}
