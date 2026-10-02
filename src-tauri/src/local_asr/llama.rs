//! In-process llama.cpp/MTMD adapter for audio GGUF models.
//!
//! The R2T2 model is a multimodal llama.cpp model: the GGUF contains the
//! language model and the companion `mmproj` GGUF contains the audio encoder.
//! Keeping this adapter in the Tauri process means users only need to download
//! the model files; they do not need to install or configure an executable.
//!
//! The model, multimodal projector, and llama context are cached for the
//! lifetime of the process (keyed by model/projector paths) because loading a
//! ~1 GB GGUF dominates first-token latency. Batch and streaming callers both
//! go through [`with_engine`], which serializes access to the shared KV state.

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use encoding_rs::UTF_8;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::mtmd::{
    mtmd_default_marker, MtmdBitmap, MtmdContext, MtmdContextParams, MtmdInputText,
};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;

use super::audio::decode_wav_to_16k_mono;

const DEFAULT_CONTEXT: u32 = 8192;
const DEFAULT_BATCH: u32 = 2048;
const MAX_OUTPUT_TOKENS: usize = 512;

/// Whether the llama.cpp build includes the Vulkan backend. When enabled, the
/// language model is fully offloaded (`n_gpu_layers = max`) and the MTMD audio
/// encoder also runs on GPU. The Vulkan ICD ships with GPU drivers, so no
/// extra runtime needs to be installed by the user.
const GPU_ENABLED: bool = cfg!(feature = "local-asr-vulkan");

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
        let right = (left + 1).min(samples.len() - 1) as usize;
        let fraction = (source - left as f64) as f32;
        output.push(
            samples[left.min(samples.len() - 1)] * (1.0 - fraction) + samples[right] * fraction,
        );
    }
    output
}

/// Append one decoded token piece to `output` using a shared UTF-8 decoder so
/// multi-byte characters split across tokens decode correctly.
fn push_token_piece(
    model: &LlamaModel,
    token: LlamaToken,
    decoder: &mut encoding_rs::Decoder,
    output: &mut String,
) -> Result<(), String> {
    let piece = model
        .token_to_piece(token, decoder, false, None)
        .map_err(|error| error.to_string())?;
    output.push_str(&piece);
    Ok(())
}

/// Resident llama.cpp engine: model, audio projector, and a reusable decoding
/// context. The model reference is leaked to `'static` so the context (which
/// borrows the model) can live alongside it.
pub(crate) struct LlamaEngine {
    model: &'static LlamaModel,
    mtmd: MtmdContext,
    context: LlamaContext<'static>,
}

// The context is only reachable through the global engine mutex, so handing
// the engine between `spawn_blocking` worker threads is serialized and safe.
unsafe impl Send for LlamaEngine {}

#[derive(Clone, PartialEq, Eq)]
struct EngineKey {
    model_path: PathBuf,
    projector_path: PathBuf,
    num_threads: i32,
}

fn engine_cache() -> &'static Mutex<Option<(EngineKey, LlamaEngine)>> {
    static CACHE: OnceLock<Mutex<Option<(EngineKey, LlamaEngine)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn load_engine(key: &EngineKey) -> Result<LlamaEngine, String> {
    let backend = backend()?;

    let mut model_params = LlamaModelParams::default();
    if GPU_ENABLED {
        model_params = model_params.with_n_gpu_layers(u32::MAX);
    }
    // Leak the model so the loaded weights stay resident for the process
    // lifetime and dependent objects can hold 'static references.
    let model: &'static LlamaModel = Box::leak(Box::new(
        LlamaModel::load_from_file(backend, &key.model_path, &model_params)
            .map_err(|error| format!("failed to load llama.cpp GGUF: {error}"))?,
    ));

    let mtmd_params = MtmdContextParams {
        use_gpu: GPU_ENABLED,
        print_timings: false,
        n_threads: key.num_threads.clamp(1, 64),
        media_marker: std::ffi::CString::new(mtmd_default_marker())
            .map_err(|error| format!("invalid llama.cpp media marker: {error}"))?,
        image_min_tokens: -1,
        image_max_tokens: -1,
    };
    let mtmd = MtmdContext::init_from_file(
        key.projector_path
            .to_str()
            .ok_or_else(|| "llama.cpp projector path is not valid UTF-8".to_string())?,
        model,
        &mtmd_params,
    )
    .map_err(|error| format!("failed to load llama.cpp audio projector: {error}"))?;

    if !mtmd.support_audio() {
        return Err("the selected llama.cpp projector does not support audio".to_string());
    }

    let context_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(DEFAULT_CONTEXT))
        .with_n_batch(DEFAULT_BATCH)
        .with_n_ubatch(DEFAULT_BATCH)
        .with_n_threads(key.num_threads.clamp(1, 64))
        .with_n_threads_batch(key.num_threads.clamp(1, 64));
    let context = model
        .new_context(backend, context_params)
        .map_err(|error| format!("failed to create llama.cpp context: {error}"))?;

    Ok(LlamaEngine {
        model,
        mtmd,
        context,
    })
}

/// Run `f` with the resident engine for `(model_path, projector_path)`,
/// loading it on first use or when the key changes. Access is serialized
/// because the context's KV state is shared between calls.
pub(crate) fn with_engine<R>(
    model_path: &Path,
    projector_path: &Path,
    num_threads: i32,
    f: impl FnOnce(&mut LlamaEngine) -> Result<R, String>,
) -> Result<R, String> {
    let key = EngineKey {
        model_path: model_path.to_path_buf(),
        projector_path: projector_path.to_path_buf(),
        num_threads,
    };
    let cache = engine_cache();
    let mut guard = cache
        .lock()
        .map_err(|_| "local ASR engine lock poisoned".to_string())?;
    let stale = match guard.as_ref() {
        Some((cached, _)) => cached != &key,
        None => true,
    };
    if stale {
        *guard = Some((key.clone(), load_engine(&key)?));
    }
    let engine = &mut guard.as_mut().expect("engine just loaded").1;
    f(engine)
}

/// Map the app's language setting to the canonical name used by the
/// Qwen3-ASR/R2T2 prompt. Unknown or automatic values return `None` so the
/// model detects the language itself.
pub(crate) fn canonical_language(language: Option<&str>) -> Option<&'static str> {
    match language?.trim().to_ascii_lowercase().as_str() {
        "zh" | "zh-cn" | "zh-tw" | "chinese" | "cmn" | "mandarin" => Some("Chinese"),
        "en" | "en-us" | "en-gb" | "english" => Some("English"),
        "ja" | "japanese" => Some("Japanese"),
        "ko" | "korean" => Some("Korean"),
        "yue" | "cantonese" | "zh-hk" => Some("Cantonese"),
        "de" | "german" => Some("German"),
        "fr" | "french" => Some("French"),
        "es" | "spanish" => Some("Spanish"),
        _ => None,
    }
}

/// Build the canonical R2T2/Qwen3-ASR chat prompt. The mtmd media marker
/// occupies the audio slot; it expands to `<|audio_start|>` + audio tokens +
/// `<|audio_end|>` during tokenization. When `force_language` is set the
/// assistant turn is pre-seeded with `language X<asr_text>` so the model
/// outputs text only; `assistant_prefix` additionally carries already
/// committed streaming text for incremental decoding.
pub(crate) fn r2t2_prompt(
    context: &str,
    force_language: Option<&str>,
    assistant_prefix: &str,
) -> String {
    let marker = mtmd_default_marker();
    let mut prompt = format!(
        "<|im_start|>system\n{context}<|im_end|>\n<|im_start|>user\n{marker}<|im_end|>\n<|im_start|>assistant\n"
    );
    if let Some(language) = force_language {
        prompt.push_str("language ");
        prompt.push_str(language);
        prompt.push_str("<asr_text>");
    }
    prompt.push_str(assistant_prefix);
    prompt
}

/// Extract transcription text from a raw model output. The model may prefix
/// output with `language X<asr_text>` metadata; alternates are separated by
/// `|` and only the first is kept.
pub(crate) fn parse_asr_text(raw: &str) -> String {
    let body = match raw.split_once("<asr_text>") {
        Some((_, tail)) => tail,
        None => raw,
    };
    body.split('|').next().unwrap_or("").trim().to_string()
}

impl LlamaEngine {
    /// Tokenize text with the model's own tokenizer (no BOS). Used by the
    /// streaming path to roll back the last tokens of committed text.
    pub(crate) fn tokenize(&self, text: &str) -> Result<Vec<LlamaToken>, String> {
        self.model
            .str_to_token(text, AddBos::Never)
            .map_err(|error| format!("llama.cpp tokenize failed: {error}"))
    }

    /// Detokenize tokens with a shared UTF-8 decoder. Partial byte sequences
    /// surface as U+FFFD, matching the upstream streaming rollback check.
    pub(crate) fn detokenize(&self, tokens: &[LlamaToken]) -> String {
        let mut decoder = UTF_8.new_decoder();
        let mut output = String::new();
        for token in tokens.iter().copied() {
            if self
                .model
                .token_to_piece(token, &mut decoder, true, None)
                .map(|piece| output.push_str(&piece))
                .is_err()
            {
                break;
            }
        }
        output
    }

    /// One full encode + greedy decode pass over `samples` (16 kHz mono).
    /// `prompt` must already contain the media marker and any prefix text.
    /// Returns the raw generated text (delta after the prompt's prefix).
    pub(crate) fn generate_once(
        &mut self,
        samples: &[f32],
        prompt: &str,
        max_tokens: usize,
    ) -> Result<String, String> {
        let input_rate = self.mtmd.get_audio_sample_rate().unwrap_or(16_000);
        let samples = resample(samples, 16_000, input_rate);
        let bitmap = MtmdBitmap::from_audio_data(&samples)
            .map_err(|error| format!("failed to prepare audio for llama.cpp: {error}"))?;
        let chunks = self
            .mtmd
            .tokenize(
                MtmdInputText {
                    text: prompt.to_string(),
                    add_special: true,
                    parse_special: true,
                },
                &[&bitmap],
            )
            .map_err(|error| format!("failed to tokenize llama.cpp audio prompt: {error}"))?;

        self.context.clear_kv_cache();
        let mut n_past = chunks
            .eval_chunks(
                &self.mtmd,
                &self.context,
                0,
                0,
                DEFAULT_BATCH as i32,
                true,
            )
            .map_err(|error| format!("failed to evaluate llama.cpp audio prompt: {error}"))?;

        let mut sampler = LlamaSampler::greedy();
        let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(1, 1);
        let mut decoder = UTF_8.new_decoder();
        let mut output = String::new();

        for _ in 0..max_tokens {
            let token = sampler.sample(&self.context, -1);
            if self.model.is_eog_token(token) || token == self.model.token_eos() {
                break;
            }
            push_token_piece(self.model, token, &mut decoder, &mut output)?;
            sampler.accept(token);

            batch.clear();
            batch
                .add(token, n_past, &[0], true)
                .map_err(|error| format!("failed to build llama.cpp decode batch: {error}"))?;
            self.context
                .decode(&mut batch)
                .map_err(|error| format!("failed to decode llama.cpp output: {error}"))?;
            n_past += 1;
        }

        Ok(output)
    }
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
    let prompt = r2t2_prompt("", canonical_language(language), "");
    let output = with_engine(model_path, projector_path, num_threads, |engine| {
        engine.generate_once(&samples, &prompt, MAX_OUTPUT_TOKENS)
    })?;

    let text = parse_asr_text(&output);
    if text.is_empty() {
        return Err("llama.cpp returned an empty transcription".to_string());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real-model smoke test for the resident engine. Run with:
    ///   TYPEFREE_R2T2_MODEL=<gguf> TYPEFREE_R2T2_MMPROJ=<mmproj> \
    ///   cargo test local_asr::llama::tests::engine_smoke -- --ignored --nocapture
    /// llama.cpp writes its backend/device selection to stderr (visible with
    /// --nocapture), which is how Vulkan engagement is verified.
    #[test]
    #[ignore]
    fn engine_smoke() {
        let model = std::env::var("TYPEFREE_R2T2_MODEL")
            .expect("TYPEFREE_R2T2_MODEL must point at the R2T2 GGUF");
        let projector = std::env::var("TYPEFREE_R2T2_MMPROJ")
            .expect("TYPEFREE_R2T2_MMPROJ must point at the mmproj GGUF");

        // 3 seconds of 220 Hz sine at 16 kHz: not meaningful speech, but the
        // encode+decode path exercises every GPU-backed op.
        let samples: Vec<f32> = (0..48_000)
            .map(|i| (i as f32 * 220.0 * std::f32::consts::TAU / 16_000.0).sin() * 0.1)
            .collect();

        let start = std::time::Instant::now();
        let prompt = r2t2_prompt("", Some("Chinese"), "");
        let output = with_engine(
            Path::new(&model),
            Path::new(&projector),
            4,
            |engine| engine.generate_once(&samples, &prompt, 64),
        )
        .expect("engine smoke inference failed");
        eprintln!(
            "[engine_smoke] first pass (load+warmup) took {:?}, raw output: {:?}",
            start.elapsed(),
            output
        );

        let start = std::time::Instant::now();
        let output = with_engine(
            Path::new(&model),
            Path::new(&projector),
            4,
            |engine| engine.generate_once(&samples, &prompt, 64),
        )
        .expect("second pass failed");
        eprintln!(
            "[engine_smoke] resident pass took {:?}, raw output: {:?}",
            start.elapsed(),
            output
        );
    }

    /// End-to-end transcription on real speech audio:
    ///   TYPEFREE_R2T2_MODEL=<gguf> TYPEFREE_R2T2_MMPROJ=<mmproj> \
    ///   TYPEFREE_R2T2_WAV=<16k wav> \
    ///   cargo test local_asr::llama::tests::transcribe_smoke -- --ignored --nocapture
    #[test]
    #[ignore]
    fn transcribe_smoke() {
        let model = std::env::var("TYPEFREE_R2T2_MODEL")
            .expect("TYPEFREE_R2T2_MODEL must point at the R2T2 GGUF");
        let projector = std::env::var("TYPEFREE_R2T2_MMPROJ")
            .expect("TYPEFREE_R2T2_MMPROJ must point at the mmproj GGUF");
        let wav = std::env::var("TYPEFREE_R2T2_WAV")
            .expect("TYPEFREE_R2T2_WAV must point at a WAV file");
        let audio = std::fs::read(&wav).expect("failed to read WAV fixture");

        let start = std::time::Instant::now();
        let text = transcribe(
            Path::new(&model),
            Path::new(&projector),
            &audio,
            Some("en"),
            4,
        )
        .expect("transcribe failed");
        eprintln!(
            "[transcribe_smoke] took {:?}, text: {:?}",
            start.elapsed(),
            text
        );
        assert!(!text.trim().is_empty(), "expected non-empty transcription");
    }
}
