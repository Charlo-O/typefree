//! Streaming R2T2 transcription sessions over the resident llama.cpp engine.
//!
//! This ports the upstream `r2t2` streaming algorithm (`r2t2_asr.py`) to the
//! in-process adapter: incoming 16 kHz PCM is buffered into fixed-size chunks;
//! whenever a full chunk is ready, the *entire* accumulated audio is re-fed to
//! the model together with the previously committed text as an assistant
//! prefix, and only a few new tokens are generated. Committed text is never
//! revised, so partial results can be emitted live.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;

use regex::Regex;
use tauri::AppHandle;
use uuid::Uuid;

use crate::commands::command_error::{CommandError, CommandResult};
use crate::transcription::domain::{emit_transcript_event, TranscriptEvent};

use super::llama::{canonical_language, r2t2_prompt, with_engine, LlamaEngine};

const SAMPLE_RATE: usize = 16_000;
/// Decode pass interval. R2T2 supports 80 ms..2 s; 1 s keeps per-pass cost low
/// while still updating the transcript roughly once per second.
const CHUNK_SIZE_SEC: f32 = 1.0;
/// Tokens generated per incremental pass. Dense speech can exceed 4 tokens per
/// second, so allow a bit of headroom; unfinished words simply continue on the
/// next pass after rollback.
const STEP_MAX_TOKENS: usize = 16;
const FINISH_MAX_TOKENS: usize = 512;
/// First N decode passes ignore previous output as prefix (warmup).
const UNFIXED_CHUNK_NUM: usize = 1;
/// Roll back the last K tokens of committed text each pass to let the model
/// correct unstable boundary tokens.
const UNFIXED_TOKEN_NUM: usize = 3;

const LOCAL_ASR_STREAM_TRANSCRIPT_EVENT_NAME: &str = "local-asr-streaming-transcript";

enum StreamMsg {
    Audio(Vec<f32>),
    Finish(Sender<Result<String, String>>),
    Cancel,
}

fn sessions() -> &'static Mutex<HashMap<String, Sender<StreamMsg>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Sender<StreamMsg>>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Streaming state for a single utterance, mirroring `ASRStreamingState`.
struct StreamState {
    buffer: Vec<f32>,
    audio_accum: Vec<f32>,
    prompt_raw: String,
    force_language: Option<&'static str>,
    language: String,
    text: String,
    raw_decoded: String,
    chunk_id: usize,
}

impl StreamState {
    fn new(language: Option<&str>) -> Self {
        let force_language = canonical_language(language);
        Self {
            buffer: Vec::new(),
            audio_accum: Vec::new(),
            prompt_raw: r2t2_prompt("", force_language, ""),
            force_language,
            language: String::new(),
            text: String::new(),
            raw_decoded: String::new(),
            chunk_id: 0,
        }
    }

    /// Roll back the last `k` tokens of the committed text so the model can
    /// refine unstable tail tokens. Mirrors the upstream prefix strategy;
    /// retokenize/detokenize keeps token boundaries identical to the model's.
    fn rollback_prefix(
        &self,
        engine: &LlamaEngine,
        token_num: usize,
        min_keep: usize,
    ) -> Result<String, String> {
        let raw = self
            .raw_decoded
            .split('|')
            .next()
            .unwrap_or("")
            .to_string();
        let ids = engine.tokenize(&raw)?;
        let mut k = token_num;
        loop {
            let end = ids.len().saturating_sub(k).max(min_keep).min(ids.len());
            let prefix = engine.detokenize(&ids[..end]);
            if !prefix.contains('\u{fffd}') || end <= min_keep {
                return Ok(prefix.split('|').next().unwrap_or("").to_string());
            }
            k += 1;
        }
    }

    /// One incremental decode pass over all accumulated audio.
    fn decode_step(&mut self, engine: &mut LlamaEngine) -> Result<(), String> {
        let prefix = if self.chunk_id < UNFIXED_CHUNK_NUM {
            String::new()
        } else {
            self.rollback_prefix(engine, UNFIXED_TOKEN_NUM, 0)?
        };
        let prompt = format!("{}{}", self.prompt_raw, prefix);
        let gen_raw = engine.generate_once(&self.audio_accum, &prompt, STEP_MAX_TOKENS)?;
        let gen = normalize_punct(&gen_raw).replace('\u{fffd}', "");
        self.raw_decoded = format!("{prefix}{gen}");
        self.refresh_text();
        Ok(())
    }

    /// Final pass over any remaining buffered audio plus all accumulated audio.
    fn finish(&mut self, engine: &mut LlamaEngine) -> Result<String, String> {
        if !self.buffer.is_empty() {
            let tail = std::mem::take(&mut self.buffer);
            self.audio_accum.extend_from_slice(&tail);
        }
        if self.audio_accum.is_empty() {
            return Ok(self.text.clone());
        }

        let prefix = if self.chunk_id < UNFIXED_CHUNK_NUM {
            String::new()
        } else {
            self.rollback_prefix(engine, UNFIXED_TOKEN_NUM, 1)?
        };
        let prompt = format!("{}{}", self.prompt_raw, prefix);
        let gen_raw = engine.generate_once(&self.audio_accum, &prompt, FINISH_MAX_TOKENS)?;
        let gen = normalize_punct(&gen_raw).replace('\u{fffd}', "");
        self.raw_decoded = format!("{prefix}{gen}")
            .split('|')
            .next()
            .unwrap_or("")
            .to_string();
        let (_, text) = parse_asr_output(&self.raw_decoded, self.force_language);
        self.text = text.split('|').next().unwrap_or("").to_string();
        Ok(self.text.clone())
    }

    /// Re-parse `raw_decoded` into (language, text) exactly like the upstream
    /// per-chunk cleanup: punctuation normalization already happened on the
    /// delta, here we normalize the accumulated string and extract the
    /// committed text.
    fn refresh_text(&mut self) {
        if self.force_language.is_none() {
            let (lang, _) = parse_asr_output(&self.raw_decoded, None);
            self.language = lang;
        }
        if self.force_language == Some("Chinese") || self.language == "Chinese" {
            self.raw_decoded = strip_cjk_inner_spaces(&self.raw_decoded);
        }
        let (lang, text) = parse_asr_output(&self.raw_decoded, self.force_language);
        let has_tag = self.raw_decoded.contains("<asr_text>");
        self.raw_decoded = if has_tag {
            let meta = self
                .raw_decoded
                .split("<asr_text>")
                .next()
                .unwrap_or("")
                .to_string();
            format!("{meta}<asr_text>{text}")
        } else {
            text.clone()
        };
        self.raw_decoded = self
            .raw_decoded
            .split('|')
            .next()
            .unwrap_or("")
            .to_string();

        // Without a forced language the model must first emit its
        // `language X<asr_text>` header; until then there is no usable text.
        if !self.raw_decoded.contains("<asr_text>") && self.force_language.is_none() {
            self.text.clear();
            return;
        }
        self.language = lang;
        self.text = text.split('|').next().unwrap_or("").to_string();
        self.chunk_id += 1;
    }
}

/// `<asr_text>`-aware output parser matching qwen_asr's `parse_asr_output`:
/// returns (language, text). `|` separates alternates and is dropped by callers.
fn parse_asr_output(raw: &str, forced_language: Option<&str>) -> (String, String) {
    let s = raw.trim();
    if s.is_empty() {
        return (String::new(), String::new());
    }
    if let Some(lang) = forced_language {
        return (lang.to_string(), s.to_string());
    }
    let Some((meta, text)) = s.split_once("<asr_text>") else {
        return (String::new(), s.to_string());
    };
    if meta.to_ascii_lowercase().contains("language none") {
        return (String::new(), text.trim().to_string());
    }
    let lang = meta
        .lines()
        .find_map(|line| {
            let line = line.trim();
            line.to_ascii_lowercase()
                .strip_prefix("language")
                .map(|rest| rest.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .map(|value| {
            let mut chars = value.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => value,
            }
        })
        .unwrap_or_default();
    (lang, text.trim().to_string())
}

/// Port of `_normalize_punct_by_context`: punctuation after a CJK character
/// becomes full-width, after ASCII alphanumerics/quotes it becomes half-width.
fn normalize_punct(text: &str) -> String {
    static PUNCT: OnceLock<Regex> = OnceLock::new();
    let re = PUNCT.get_or_init(|| {
        Regex::new(r"[,\.!?;:()\u{ff0c}\u{3002}\u{ff01}\u{ff1f}\u{ff1b}\u{ff1a}\u{ff08}\u{ff09}]")
            .expect("punct regex")
    });
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for m in re.find_iter(text) {
        out.push_str(&text[last..m.start()]);
        let mark = m.as_str();
        let prev = text[..m.start()]
            .chars()
            .rev()
            .find(|c| !c.is_whitespace());
        let mapped = match prev {
            Some(c) if ('\u{4e00}'..='\u{9fff}').contains(&c) => match mark {
                "," => "，",
                "." => "。",
                "!" => "！",
                "?" => "？",
                ";" => "；",
                ":" => "：",
                "(" => "（",
                ")" => "）",
                other => other,
            },
            Some(c)
                if c.is_ascii() && (c.is_alphanumeric() || c == '"' || c == '\'') =>
            {
                match mark {
                    "，" => ",",
                    "。" => ".",
                    "！" => "!",
                    "？" => "?",
                    "；" => ";",
                    "：" => ":",
                    "（" => "(",
                    "）" => ")",
                    other => other,
                }
            }
            _ => mark,
        };
        out.push_str(mapped);
        last = m.end();
    }
    out.push_str(&text[last..]);
    out
}

/// Remove whitespace between adjacent CJK characters (upstream applies the same
/// cleanup for Chinese transcripts).
fn strip_cjk_inner_spaces(text: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE
        .get_or_init(|| Regex::new(r"([\u{4e00}-\u{9fff}])\s+([\u{4e00}-\u{9fff}])").expect("cjk"));
    re.replace_all(text, "$1$2").into_owned()
}

fn run_stream_session(
    app: AppHandle,
    session_id: String,
    rx: Receiver<StreamMsg>,
    model_path: PathBuf,
    projector_path: PathBuf,
    num_threads: i32,
    language: Option<String>,
) {
    let mut state = StreamState::new(language.as_deref());
    let emit_partial = |state: &StreamState, is_final: bool| {
        emit_transcript_event(
            &app,
            LOCAL_ASR_STREAM_TRANSCRIPT_EVENT_NAME,
            TranscriptEvent::streaming("local", session_id.clone(), state.text.clone(), is_final)
                .with_audio_ms(Some((state.audio_accum.len() * 1000 / SAMPLE_RATE) as u64))
                .with_definite(is_final),
        );
    };

    // Warm the engine while the first audio arrives so session start does not
    // block on the multi-hundred-MB model load.
    if let Err(error) = with_engine(&model_path, &projector_path, num_threads, |_| Ok(())) {
        eprintln!("[local-asr-stream] engine preload failed: {error}");
    }

    for msg in rx {
        match msg {
            StreamMsg::Audio(samples) => {
                state.buffer.extend_from_slice(&samples);
                let chunk_samples = (CHUNK_SIZE_SEC * SAMPLE_RATE as f32) as usize;
                while state.buffer.len() >= chunk_samples {
                    let chunk: Vec<f32> = state.buffer.drain(..chunk_samples).collect();
                    state.audio_accum.extend_from_slice(&chunk);
                    match with_engine(&model_path, &projector_path, num_threads, |engine| {
                        state.decode_step(engine)
                    }) {
                        Ok(()) => emit_partial(&state, false),
                        Err(error) => {
                            eprintln!("[local-asr-stream] decode pass failed: {error}");
                        }
                    }
                }
            }
            StreamMsg::Finish(reply) => {
                let result = with_engine(&model_path, &projector_path, num_threads, |engine| {
                    state.finish(engine)
                });
                if result.is_ok() {
                    emit_partial(&state, true);
                }
                let _ = reply.send(result);
                return;
            }
            StreamMsg::Cancel => return,
        }
    }
}

pub(crate) fn start_stream_session(
    app: AppHandle,
    model_path: String,
    projector_path: String,
    num_threads: i32,
    language: Option<String>,
) -> CommandResult<String> {
    let model_path = model_path.trim().to_string();
    let projector_path = projector_path.trim().to_string();
    if model_path.is_empty() || !Path::new(&model_path).is_file() {
        return Err(CommandError::configuration(
            "local ASR streaming requires a downloaded llama.cpp model",
        ));
    }
    if projector_path.is_empty() || !Path::new(&projector_path).is_file() {
        return Err(CommandError::configuration(
            "local ASR streaming requires the llama.cpp audio projector",
        ));
    }

    let session_id = Uuid::new_v4().to_string();
    let (tx, rx) = channel::<StreamMsg>();
    {
        let mut map = sessions()
            .lock()
            .map_err(|_| CommandError::internal("local ASR session map poisoned"))?;
        map.insert(session_id.clone(), tx);
    }

    let worker_app = app.clone();
    let worker_session = session_id.clone();
    if let Err(error) = thread::Builder::new()
        .name(format!("local-asr-stream-{worker_session}"))
        .spawn(move || {
            run_stream_session(
                worker_app,
                worker_session,
                rx,
                PathBuf::from(model_path),
                PathBuf::from(projector_path),
                num_threads,
                language,
            );
        })
    {
        let _ = sessions().lock().map(|mut map| map.remove(&session_id));
        return Err(CommandError::internal(format!(
            "failed to start local ASR streaming worker: {error}"
        )));
    }
    Ok(session_id)
}

pub(crate) async fn send_stream_audio(
    session_id: String,
    pcm_data: Vec<u8>,
) -> CommandResult<()> {
    let sender = {
        let map = sessions()
            .lock()
            .map_err(|_| CommandError::internal("local ASR session map poisoned"))?;
        map.get(&session_id).cloned()
    };
    let Some(sender) = sender else {
        return Err(CommandError::configuration(
            "local ASR streaming session not found",
        ));
    };
    if pcm_data.len() % 2 != 0 {
        return Err(CommandError::configuration(
            "local ASR audio chunk must be 16-bit PCM",
        ));
    }
    let samples: Vec<f32> = pcm_data
        .chunks_exact(2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / 32768.0)
        .collect();
    sender
        .send(StreamMsg::Audio(samples))
        .map_err(|_| CommandError::internal("local ASR streaming session is closed"))
}

pub(crate) async fn finish_stream_session(session_id: String) -> CommandResult<String> {
    let sender = {
        let mut map = sessions()
            .lock()
            .map_err(|_| CommandError::internal("local ASR session map poisoned"))?;
        map.remove(&session_id)
    };
    let Some(sender) = sender else {
        return Err(CommandError::configuration(
            "local ASR streaming session not found",
        ));
    };
    let (reply_tx, reply_rx) = channel();
    sender
        .send(StreamMsg::Finish(reply_tx))
        .map_err(|_| CommandError::internal("local ASR streaming session is closed"))?;
    let result = reply_rx
        .recv()
        .map_err(|_| CommandError::internal("local ASR streaming session ended early"))?;
    result.map_err(CommandError::from_message)
}

pub(crate) async fn cancel_stream_session(session_id: String) -> CommandResult<()> {
    let sender = {
        let mut map = sessions()
            .lock()
            .map_err(|_| CommandError::internal("local ASR session map poisoned"))?;
        map.remove(&session_id)
    };
    if let Some(sender) = sender {
        let _ = sender.send(StreamMsg::Cancel);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_asr::audio::decode_wav_to_16k_mono;

    /// Drives the streaming state machine end-to-end on real audio, chunked
    /// like the live pipeline (1 s of 16 kHz PCM per decode pass).
    ///   TYPEFREE_R2T2_MODEL=<gguf> TYPEFREE_R2T2_MMPROJ=<mmproj> \
    ///   TYPEFREE_R2T2_WAV=<16k wav> \
    ///   cargo test local_asr::stream::tests::stream_smoke -- --ignored --nocapture
    #[test]
    #[ignore]
    fn stream_smoke() {
        let model = std::env::var("TYPEFREE_R2T2_MODEL")
            .expect("TYPEFREE_R2T2_MODEL must point at the R2T2 GGUF");
        let projector = std::env::var("TYPEFREE_R2T2_MMPROJ")
            .expect("TYPEFREE_R2T2_MMPROJ must point at the mmproj GGUF");
        let wav = std::env::var("TYPEFREE_R2T2_WAV")
            .expect("TYPEFREE_R2T2_WAV must point at a WAV file");
        let audio = std::fs::read(&wav).expect("failed to read WAV fixture");
        let samples = decode_wav_to_16k_mono(&audio).expect("failed to decode WAV fixture");

        let mut state = StreamState::new(Some("en"));
        let chunk_samples = (CHUNK_SIZE_SEC * SAMPLE_RATE as f32) as usize;
        let mut pass = 0usize;

        for chunk in samples.chunks(chunk_samples) {
            state.buffer.extend_from_slice(chunk);
            while state.buffer.len() >= chunk_samples {
                let piece: Vec<f32> = state.buffer.drain(..chunk_samples).collect();
                state.audio_accum.extend_from_slice(&piece);
                let start = std::time::Instant::now();
                with_engine(
                    Path::new(&model),
                    Path::new(&projector),
                    4,
                    |engine| state.decode_step(engine),
                )
                .expect("decode pass failed");
                eprintln!(
                    "[stream_smoke] pass {} ({:.1}s audio) took {:?}: {:?}",
                    pass,
                    state.audio_accum.len() as f32 / SAMPLE_RATE as f32,
                    start.elapsed(),
                    state.text
                );
                pass += 1;
            }
        }

        let start = std::time::Instant::now();
        let text = with_engine(
            Path::new(&model),
            Path::new(&projector),
            4,
            |engine| state.finish(engine),
        )
        .expect("finish failed");
        eprintln!("[stream_smoke] finish took {:?}, final: {:?}", start.elapsed(), text);
        assert!(!text.trim().is_empty(), "expected non-empty transcription");
    }
}
