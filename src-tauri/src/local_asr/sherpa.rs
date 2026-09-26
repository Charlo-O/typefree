//! Optional sherpa-onnx offline ASR adapter.
//!
//! This adapter consumes normalized 16 kHz mono samples.  Keeping audio
//! decoding outside the adapter lets the existing recording pipeline choose
//! the platform-specific container conversion and keeps the native binding
//! behind an opt-in Cargo feature.

use std::path::Path;

use sherpa_onnx::{
    OfflineParaformerModelConfig, OfflineQwen3ASRModelConfig, OfflineRecognizer,
    OfflineRecognizerConfig, OfflineSenseVoiceModelConfig, OfflineWhisperModelConfig,
};

/// Recognize 16 kHz mono samples with a sherpa-onnx SenseVoice model.
pub(crate) fn recognize_sense_voice(
    model_path: &Path,
    samples: &[f32],
    language: Option<&str>,
    num_threads: i32,
) -> Result<String, String> {
    if samples.is_empty() {
        return Err("local ASR audio samples cannot be empty".to_string());
    }
    if !model_path.is_file() {
        return Err(format!(
            "sherpa-onnx SenseVoice model does not exist: {}",
            model_path.display()
        ));
    }

    recognize_with_config(model_path, samples, num_threads, "SenseVoice", |config| {
        config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
            model: Some(model_path.to_string_lossy().into_owned()),
            language: language
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned),
            use_itn: true,
        };
    })
}

pub(crate) fn recognize_paraformer(
    model_path: &Path,
    samples: &[f32],
    num_threads: i32,
) -> Result<String, String> {
    recognize_with_config(model_path, samples, num_threads, "Paraformer", |config| {
        config.model_config.paraformer = OfflineParaformerModelConfig {
            model: Some(model_path.to_string_lossy().into_owned()),
        };
    })
}

pub(crate) fn recognize_whisper(
    encoder_path: &Path,
    decoder_path: &Path,
    samples: &[f32],
    language: Option<&str>,
    num_threads: i32,
) -> Result<String, String> {
    if !encoder_path.is_file() {
        return Err(format!(
            "sherpa-onnx Whisper encoder does not exist: {}",
            encoder_path.display()
        ));
    }
    if !decoder_path.is_file() {
        return Err(format!(
            "sherpa-onnx Whisper decoder does not exist: {}",
            decoder_path.display()
        ));
    }
    if samples.is_empty() {
        return Err("local ASR audio samples cannot be empty".to_string());
    }

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.whisper = OfflineWhisperModelConfig {
        encoder: Some(encoder_path.to_string_lossy().into_owned()),
        decoder: Some(decoder_path.to_string_lossy().into_owned()),
        language: language
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        task: Some("transcribe".to_string()),
        ..Default::default()
    };
    config.model_config.num_threads = num_threads.max(1);
    decode(&config, samples, "Whisper")
}

/// Recognize Qwen3-ASR ONNX bundles.  sherpa-onnx expects four files rather
/// than a single model path: conv_frontend, encoder, decoder and tokenizer.
pub(crate) fn recognize_qwen3_asr(
    conv_frontend_path: &Path,
    encoder_path: &Path,
    decoder_path: &Path,
    tokenizer_path: &Path,
    samples: &[f32],
    num_threads: i32,
) -> Result<String, String> {
    for (label, path) in [
        ("conv_frontend", conv_frontend_path),
        ("encoder", encoder_path),
        ("decoder", decoder_path),
        ("tokenizer", tokenizer_path),
    ] {
        if !path.is_file() {
            return Err(format!(
                "sherpa-onnx Qwen3-ASR {label} does not exist: {}",
                path.display()
            ));
        }
    }
    if samples.is_empty() {
        return Err("local ASR audio samples cannot be empty".to_string());
    }

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.qwen3_asr = OfflineQwen3ASRModelConfig {
        conv_frontend: Some(conv_frontend_path.to_string_lossy().into_owned()),
        encoder: Some(encoder_path.to_string_lossy().into_owned()),
        decoder: Some(decoder_path.to_string_lossy().into_owned()),
        tokenizer: Some(tokenizer_path.to_string_lossy().into_owned()),
        ..Default::default()
    };
    config.model_config.num_threads = num_threads.max(1);
    decode(&config, samples, "Qwen3-ASR")
}

fn recognize_with_config(
    model_path: &Path,
    samples: &[f32],
    num_threads: i32,
    family_name: &str,
    configure: impl FnOnce(&mut OfflineRecognizerConfig),
) -> Result<String, String> {
    if samples.is_empty() {
        return Err("local ASR audio samples cannot be empty".to_string());
    }
    if !model_path.is_file() {
        return Err(format!(
            "sherpa-onnx {family_name} model does not exist: {}",
            model_path.display()
        ));
    }

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.num_threads = num_threads.max(1);
    configure(&mut config);
    decode(&config, samples, family_name)
}

fn decode(
    config: &OfflineRecognizerConfig,
    samples: &[f32],
    family_name: &str,
) -> Result<String, String> {
    let recognizer = OfflineRecognizer::create(config)
        .ok_or_else(|| format!("failed to create sherpa-onnx {family_name} recognizer"))?;
    let stream = recognizer.create_stream();
    stream.accept_waveform(16_000, samples);
    recognizer.decode(&stream);

    stream
        .get_result()
        .map(|result| result.text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("sherpa-onnx {family_name} returned empty text"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_samples_before_loading_native_runtime() {
        let error = recognize_sense_voice(Path::new("missing.onnx"), &[], None, 1)
            .expect_err("empty samples must be rejected");
        assert!(error.contains("samples"));
    }
}
