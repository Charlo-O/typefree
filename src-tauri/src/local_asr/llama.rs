//! In-process llama.cpp/MTMD adapter for audio GGUF models.
//!
//! The R2T2 model is a multimodal llama.cpp model: the GGUF contains the
//! language model and the companion `mmproj` GGUF contains the audio encoder.
//! Keeping this adapter in the Tauri process means users only need to download
//! the model files; they do not need to install or configure an executable.

use std::num::NonZeroU32;
use std::path::Path;
use std::sync::OnceLock;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::mtmd::{
    mtmd_default_marker, MtmdBitmap, MtmdContext, MtmdContextParams, MtmdInputText,
};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;

use super::audio::decode_wav_to_16k_mono;

const DEFAULT_CONTEXT: u32 = 4096;
const DEFAULT_BATCH: u32 = 2048;
const MAX_OUTPUT_TOKENS: usize = 512;

static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();

fn backend() -> Result<&'static LlamaBackend, String> {
    BACKEND
        .get_or_init(|| LlamaBackend::init().map_err(|error| error.to_string()))
        .as_ref()
        .map_err(Clone::clone)
}

fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let output_len = ((samples.len() as u64 * u64::from(to_rate) + u64::from(from_rate) - 1)
        / u64::from(from_rate)) as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let source = index as f64 * f64::from(from_rate) / f64::from(to_rate);
        let left = source.floor() as usize;
        let right = (left + 1).min(samples.len() - 1);
        let fraction = (source - left as f64) as f32;
        output.push(
            samples[left.min(samples.len() - 1)] * (1.0 - fraction) + samples[right] * fraction,
        );
    }
    output
}

fn token_piece(model: &LlamaModel, token: LlamaToken) -> Result<String, String> {
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    model
        .token_to_piece(token, &mut decoder, false, None)
        .map_err(|error| error.to_string())
}

/// Transcribe a PCM WAV payload with an in-process llama.cpp MTMD model.
pub(crate) fn transcribe(
    model_path: &Path,
    projector_path: &Path,
    audio_data: &[u8],
    language: Option<&str>,
    num_threads: i32,
) -> Result<String, String> {
    if !model_path.is_file() {
        return Err(format!(
            "llama.cpp model does not exist: {}",
            model_path.display()
        ));
    }
    if !projector_path.is_file() {
        return Err(format!(
            "llama.cpp audio projector does not exist: {}",
            projector_path.display()
        ));
    }

    let samples = decode_wav_to_16k_mono(audio_data)?;
    let backend = backend()?;
    let model = LlamaModel::load_from_file(backend, model_path, &LlamaModelParams::default())
        .map_err(|error| format!("failed to load llama.cpp GGUF: {error}"))?;

    let mtmd_params = MtmdContextParams {
        use_gpu: false,
        print_timings: false,
        n_threads: num_threads.clamp(1, 64),
        media_marker: std::ffi::CString::new(mtmd_default_marker())
            .map_err(|error| format!("invalid llama.cpp media marker: {error}"))?,
        image_min_tokens: -1,
        image_max_tokens: -1,
    };
    let mtmd = MtmdContext::init_from_file(
        projector_path
            .to_str()
            .ok_or_else(|| "llama.cpp projector path is not valid UTF-8".to_string())?,
        &model,
        &mtmd_params,
    )
    .map_err(|error| format!("failed to load llama.cpp audio projector: {error}"))?;

    if !mtmd.support_audio() {
        return Err("the selected llama.cpp projector does not support audio".to_string());
    }
    let input_rate = mtmd.get_audio_sample_rate().unwrap_or(16_000);
    let samples = resample(&samples, 16_000, input_rate);
    let bitmap = MtmdBitmap::from_audio_data(&samples)
        .map_err(|error| format!("failed to prepare audio for llama.cpp: {error}"))?;

    let language_hint = language
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" Language hint: {value}."))
        .unwrap_or_default();
    let prompt = format!(
        "<__media__>\nTranscribe this audio accurately. Output only the spoken words without commentary.{language_hint}"
    );
    let chunks = mtmd
        .tokenize(
            MtmdInputText {
                text: prompt,
                add_special: true,
                parse_special: true,
            },
            &[&bitmap],
        )
        .map_err(|error| format!("failed to tokenize llama.cpp audio prompt: {error}"))?;

    let context_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(DEFAULT_CONTEXT))
        .with_n_batch(DEFAULT_BATCH)
        .with_n_ubatch(DEFAULT_BATCH)
        .with_n_threads(num_threads.clamp(1, 64))
        .with_n_threads_batch(num_threads.clamp(1, 64));
    let mut context = model
        .new_context(backend, context_params)
        .map_err(|error| format!("failed to create llama.cpp context: {error}"))?;

    let mut n_past = chunks
        .eval_chunks(&mtmd, &context, 0, 0, DEFAULT_BATCH as i32, true)
        .map_err(|error| format!("failed to evaluate llama.cpp audio prompt: {error}"))?;
    let mut sampler = LlamaSampler::greedy();
    let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(1, 1);
    let mut output = String::new();

    for _ in 0..MAX_OUTPUT_TOKENS {
        let token = sampler.sample(&context, -1);
        if model.is_eog_token(token) || token == model.token_eos() {
            break;
        }
        let piece = token_piece(&model, token)?;
        output.push_str(&piece);
        sampler.accept(token);

        batch.clear();
        batch
            .add(token, n_past, &[0], true)
            .map_err(|error| format!("failed to build llama.cpp decode batch: {error}"))?;
        context
            .decode(&mut batch)
            .map_err(|error| format!("failed to decode llama.cpp output: {error}"))?;
        n_past += 1;
    }

    let output = output.trim().to_string();
    if output.is_empty() {
        return Err("llama.cpp returned an empty transcription".to_string());
    }
    Ok(output)
}
