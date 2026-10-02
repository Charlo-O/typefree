//! Native local-ASR model catalog and downloader.
//!
//! The catalog lists every downloadable local ASR bundle: the GGUF pair for
//! the in-process R2T2 llama.cpp adapter plus the sherpa-onnx ONNX bundles
//! (SenseVoice, Paraformer, Whisper, Qwen3-ASR).  Downloads are written to
//! `.part` files and atomically renamed only after the complete response is
//! received.

use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs::{self, File};
use tokio::io::AsyncWriteExt;

use crate::commands::command_error::{CommandError, CommandResult};
use crate::commands::settings;

const MODEL_PROGRESS_EVENT: &str = "model-download-progress";
const HF_RESOLVE_BASE: &str = "https://huggingface.co";

/// One file inside a downloadable model bundle.  `setting_key` names the
/// backend-readable `localAsr*` setting that `model_select` writes for this
/// file; an empty key means the file is a companion asset (for example a
/// tokenizer directory member) that is located relative to another setting.
#[derive(Clone, Copy, Debug)]
struct ModelFileSpec {
    file_name: &'static str,
    expected_size: u64,
    setting_key: &'static str,
}

/// One selectable local ASR model bundle.
#[derive(Clone, Copy, Debug)]
struct LocalModelSpec {
    id: &'static str,
    name: &'static str,
    dir: &'static str,
    size: &'static str,
    description: &'static str,
    file_name: &'static str,
    quantization: &'static str,
    hf_repo: &'static str,
    recommended: bool,
    runtime: &'static str,
    family: &'static str,
    /// Extra directory (relative to the model dir) that is written to
    /// `localAsrTokenizerPath` when the family consumes a tokenizer directory
    /// instead of a tokens file (Qwen3-ASR).
    tokenizer_dir: Option<&'static str>,
    files: &'static [ModelFileSpec],
}

const R2T2_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        file_name: "Confucius4-R2T2-Q4_K_M.gguf",
        expected_size: 1_080_000_000,
        setting_key: "localAsrModelPath",
    },
    ModelFileSpec {
        file_name: "mmproj-Confucius4-R2T2-Q8_0.gguf",
        expected_size: 320_000_000,
        setting_key: "localAsrProjectorPath",
    },
];

const SENSEVOICE_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        file_name: "model.int8.onnx",
        expected_size: 239_233_841,
        setting_key: "localAsrModelPath",
    },
    ModelFileSpec {
        file_name: "tokens.txt",
        expected_size: 315_894,
        setting_key: "localAsrTokensPath",
    },
];

const PARAFORMER_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        file_name: "model.int8.onnx",
        expected_size: 81_828_675,
        setting_key: "localAsrModelPath",
    },
    ModelFileSpec {
        file_name: "tokens.txt",
        expected_size: 75_352,
        setting_key: "localAsrTokensPath",
    },
];

const WHISPER_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        file_name: "base-encoder.int8.onnx",
        expected_size: 29_120_534,
        setting_key: "localAsrEncoderPath",
    },
    ModelFileSpec {
        file_name: "base-decoder.int8.onnx",
        expected_size: 130_672_026,
        setting_key: "localAsrDecoderPath",
    },
    ModelFileSpec {
        file_name: "base-tokens.txt",
        expected_size: 816_730,
        setting_key: "localAsrTokensPath",
    },
];

const QWEN3_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        file_name: "conv_frontend.onnx",
        expected_size: 44_148_281,
        setting_key: "localAsrConvFrontendPath",
    },
    ModelFileSpec {
        file_name: "encoder.int8.onnx",
        expected_size: 182_491_662,
        setting_key: "localAsrEncoderPath",
    },
    ModelFileSpec {
        file_name: "decoder.int8.onnx",
        expected_size: 755_914_231,
        setting_key: "localAsrDecoderPath",
    },
    ModelFileSpec {
        file_name: "tokenizer/vocab.json",
        expected_size: 2_776_833,
        setting_key: "",
    },
    ModelFileSpec {
        file_name: "tokenizer/merges.txt",
        expected_size: 1_671_853,
        setting_key: "",
    },
    ModelFileSpec {
        file_name: "tokenizer/tokenizer_config.json",
        expected_size: 12_487,
        setting_key: "",
    },
];

const SPECS: &[LocalModelSpec] = &[
    LocalModelSpec {
        id: "r2t2-native-q4",
        name: "Confucius4-R2T2（原生 llama.cpp）",
        dir: "confucius4-r2t2-q4",
        size: "约 1.3 GB",
        description: "进程内 llama.cpp 音频 GGUF；下载后点击选择即可作为默认本地 ASR。",
        file_name: "Confucius4-R2T2-Q4_K_M.gguf",
        quantization: "Q4_K_M + mmproj Q8_0",
        hf_repo: "netease-youdao/Confucius4-R2T2-GGUF",
        recommended: true,
        runtime: "llama.cpp",
        family: "r2t2",
        tokenizer_dir: None,
        files: R2T2_FILES,
    },
    LocalModelSpec {
        id: "sensevoice-int8",
        name: "SenseVoice（ONNX）",
        dir: "sherpa-sensevoice-int8",
        size: "约 228 MB",
        description: "sherpa-onnx 离线识别，适合中文和多语种",
        file_name: "model.int8.onnx",
        quantization: "int8",
        hf_repo: "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
        recommended: false,
        runtime: "sherpa-onnx",
        family: "sense-voice",
        tokenizer_dir: None,
        files: SENSEVOICE_FILES,
    },
    LocalModelSpec {
        id: "paraformer-zh",
        name: "Paraformer 中文（ONNX）",
        dir: "sherpa-paraformer-zh",
        size: "约 78 MB",
        description: "中文离线/流式模型适配入口",
        file_name: "model.int8.onnx",
        quantization: "int8",
        hf_repo: "csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09",
        recommended: false,
        runtime: "sherpa-onnx",
        family: "paraformer",
        tokenizer_dir: None,
        files: PARAFORMER_FILES,
    },
    LocalModelSpec {
        id: "whisper-onnx",
        name: "Whisper（ONNX）",
        dir: "sherpa-whisper-base",
        size: "约 153 MB",
        description: "通用多语种 Whisper base int8 模型",
        file_name: "base-encoder.int8.onnx",
        quantization: "int8",
        hf_repo: "csukuangfj/sherpa-onnx-whisper-base",
        recommended: false,
        runtime: "sherpa-onnx",
        family: "whisper",
        tokenizer_dir: None,
        files: WHISPER_FILES,
    },
    LocalModelSpec {
        id: "qwen3-asr-onnx",
        name: "Qwen3-ASR（ONNX）",
        dir: "sherpa-qwen3-asr-0.6b",
        size: "约 941 MB",
        description: "需要 sherpa-onnx 对应的 conv_frontend/encoder/decoder/tokenizer 文件",
        file_name: "decoder.int8.onnx",
        quantization: "0.6B int8",
        hf_repo: "csukuangfj2/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25",
        recommended: false,
        runtime: "sherpa-onnx",
        family: "qwen3-asr",
        tokenizer_dir: Some("tokenizer"),
        files: QWEN3_FILES,
    },
];

static CANCELLATIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn cancellations() -> &'static Mutex<HashSet<String>> {
    CANCELLATIONS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_cancelled(model_id: &str) -> bool {
    cancellations()
        .lock()
        .map(|values| values.contains(model_id))
        .unwrap_or(false)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelRecord {
    pub id: String,
    pub name: String,
    pub size: String,
    pub size_bytes: u64,
    pub description: String,
    pub file_name: String,
    pub quantization: String,
    pub context_length: u32,
    pub hf_repo: String,
    pub recommended: bool,
    pub is_downloaded: bool,
    pub is_downloading: bool,
    pub download_progress: u8,
    pub downloaded: bool,
    pub model_path: Option<String>,
    pub projector_path: Option<String>,
    pub runtime: String,
    pub model_family: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCommandResult {
    pub success: bool,
    pub message: Option<String>,
    pub error: Option<String>,
    pub code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub model_id: String,
    pub progress: u8,
    pub downloaded_size: u64,
    pub total_size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelSelection {
    pub model_id: String,
    pub model_path: String,
    pub projector_path: String,
    pub runtime: String,
    pub model_family: String,
    /// Every backend setting `model_select` wrote, keyed by setting name.
    /// Lets the renderer mirror the selection into its own settings state.
    pub settings: HashMap<String, String>,
}

fn find_spec(model_id: &str) -> Result<&'static LocalModelSpec, CommandError> {
    SPECS
        .iter()
        .find(|spec| spec.id == model_id)
        .ok_or_else(|| CommandError::configuration(format!("unknown local ASR model: {model_id}")))
}

fn models_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("local-asr-models"))
}

fn model_dir(app: &AppHandle, spec: &LocalModelSpec) -> Result<PathBuf, String> {
    Ok(models_root(app)?.join(spec.dir))
}

fn file_url(spec: &LocalModelSpec, file: &ModelFileSpec) -> String {
    format!(
        "{HF_RESOLVE_BASE}/{}/resolve/main/{}?download=true",
        spec.hf_repo, file.file_name
    )
}

fn file_target(
    app: &AppHandle,
    spec: &LocalModelSpec,
    file: &ModelFileSpec,
) -> Result<PathBuf, String> {
    Ok(model_dir(app, spec)?.join(file.file_name))
}

fn all_files_exist(app: &AppHandle, spec: &LocalModelSpec) -> Result<bool, String> {
    for file in spec.files {
        if !file_target(app, spec, file)?.is_file() {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Absolute path written for a `setting_key` file, or the tokenizer directory
/// for specs whose family consumes a tokenizer directory.
fn setting_value_for(app: &AppHandle, spec: &LocalModelSpec, setting_key: &str) -> Option<String> {
    if setting_key == "localAsrTokenizerPath" {
        if let Some(dir) = spec.tokenizer_dir {
            return model_dir(app, spec)
                .ok()
                .map(|base| base.join(dir).to_string_lossy().to_string());
        }
    }
    spec.files
        .iter()
        .find(|file| file.setting_key == setting_key)
        .and_then(|file| {
            file_target(app, spec, file)
                .ok()
                .map(|path| path.to_string_lossy().to_string())
        })
}

fn record(app: &AppHandle, spec: &LocalModelSpec) -> Result<LocalModelRecord, String> {
    let downloaded = all_files_exist(app, spec)?;
    Ok(LocalModelRecord {
        id: spec.id.to_string(),
        name: spec.name.to_string(),
        size: spec.size.to_string(),
        size_bytes: spec.files.iter().map(|file| file.expected_size).sum(),
        description: spec.description.to_string(),
        file_name: spec.file_name.to_string(),
        quantization: spec.quantization.to_string(),
        context_length: if spec.id == "r2t2-native-q4" { 4096 } else { 0 },
        hf_repo: spec.hf_repo.to_string(),
        recommended: spec.recommended,
        is_downloaded: downloaded,
        is_downloading: false,
        download_progress: if downloaded { 100 } else { 0 },
        downloaded,
        model_path: setting_value_for(app, spec, "localAsrModelPath"),
        projector_path: setting_value_for(app, spec, "localAsrProjectorPath"),
        runtime: spec.runtime.to_string(),
        model_family: spec.family.to_string(),
    })
}

fn emit_progress(app: &AppHandle, model_id: &str, progress: u8, downloaded: u64, total: u64) {
    let _ = app.emit(
        MODEL_PROGRESS_EVENT,
        ModelDownloadProgress {
            model_id: model_id.to_string(),
            progress,
            downloaded_size: downloaded,
            total_size: total,
        },
    );
}

async fn download_file(
    app: &AppHandle,
    model_id: &str,
    spec: &LocalModelSpec,
    file: &ModelFileSpec,
    completed_before: u64,
    total_size: u64,
) -> Result<u64, String> {
    let target = file_target(app, spec, file)?;
    if target.is_file() {
        return Ok(file.expected_size);
    }

    let partial = target.with_extension(format!(
        "{}part",
        target.extension().and_then(|v| v.to_str()).unwrap_or("")
    ));
    if let Some(parent) = partial.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("failed to create model directory: {error}"))?;
    }
    let response = reqwest::Client::new()
        .get(file_url(spec, file))
        .send()
        .await
        .map_err(|error| format!("failed to download {}: {error}", file.file_name))?
        .error_for_status()
        .map_err(|error| format!("failed to download {}: {error}", file.file_name))?;
    let mut stream = response.bytes_stream();
    let mut output = File::create(&partial)
        .await
        .map_err(|error| format!("failed to create partial model file: {error}"))?;
    let mut downloaded = 0u64;

    while let Some(chunk) = stream.next().await {
        if is_cancelled(model_id) {
            drop(output);
            let _ = fs::remove_file(&partial).await;
            return Err("model download cancelled".to_string());
        }
        let chunk = chunk.map_err(|error| format!("model download stream failed: {error}"))?;
        output
            .write_all(&chunk)
            .await
            .map_err(|error| format!("failed to write model file: {error}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        let overall = completed_before.saturating_add(downloaded);
        let progress = ((overall.saturating_mul(100)) / total_size.max(1)).min(99) as u8;
        emit_progress(app, model_id, progress, overall, total_size);
    }
    output
        .flush()
        .await
        .map_err(|error| format!("failed to flush model file: {error}"))?;
    drop(output);
    fs::rename(&partial, target)
        .await
        .map_err(|error| format!("failed to finalize model file: {error}"))?;
    Ok(downloaded.max(file.expected_size))
}

/// Return the local-ASR catalog and current download state.
#[tauri::command]
pub fn model_get_all(app: AppHandle) -> CommandResult<Vec<LocalModelRecord>> {
    SPECS
        .iter()
        .map(|spec| record(&app, spec).map_err(CommandError::from_message))
        .collect()
}

#[tauri::command]
pub fn model_check(app: AppHandle, model_id: String) -> CommandResult<bool> {
    let spec = find_spec(&model_id)?;
    Ok(record(&app, spec)
        .map_err(CommandError::from_message)?
        .downloaded)
}

/// Download every file in the bundle using atomic temporary files.
#[tauri::command]
pub async fn model_download(app: AppHandle, model_id: String) -> CommandResult<ModelCommandResult> {
    let spec = find_spec(&model_id)?;
    if let Ok(mut values) = cancellations().lock() {
        values.remove(&model_id);
    }
    let dir = model_dir(&app, spec).map_err(CommandError::from_message)?;
    fs::create_dir_all(&dir)
        .await
        .map_err(|error| CommandError::from_message(error.to_string()))?;
    let total_size: u64 = spec.files.iter().map(|file| file.expected_size).sum();
    let mut completed = 0u64;
    emit_progress(&app, &model_id, 0, 0, total_size);
    for file in spec.files {
        completed = completed.saturating_add(
            download_file(&app, &model_id, spec, file, completed, total_size)
                .await
                .map_err(CommandError::from_message)?,
        );
    }
    emit_progress(&app, &model_id, 100, total_size, total_size);
    Ok(ModelCommandResult {
        success: true,
        message: Some("模型已下载，可点击“选择”设为默认本地 ASR。".to_string()),
        error: None,
        code: None,
    })
}

#[tauri::command]
pub async fn model_delete(app: AppHandle, model_id: String) -> CommandResult<()> {
    let spec = find_spec(&model_id)?;
    let dir = model_dir(&app, spec).map_err(CommandError::from_message)?;
    if dir.exists() {
        fs::remove_dir_all(dir)
            .await
            .map_err(|error| CommandError::from_message(error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn model_delete_all(app: AppHandle) -> CommandResult<ModelCommandResult> {
    let dir = models_root(&app).map_err(CommandError::from_message)?;
    if dir.exists() {
        fs::remove_dir_all(dir)
            .await
            .map_err(|error| CommandError::from_message(error.to_string()))?;
    }
    Ok(ModelCommandResult {
        success: true,
        message: Some("本地 ASR 模型已删除。".to_string()),
        error: None,
        code: None,
    })
}

#[tauri::command]
pub fn model_check_runtime() -> CommandResult<bool> {
    Ok(true)
}

#[tauri::command]
pub fn model_cancel_download(model_id: String) -> CommandResult<ModelCommandResult> {
    find_spec(&model_id)?;
    if let Ok(mut values) = cancellations().lock() {
        values.insert(model_id);
    }
    Ok(ModelCommandResult {
        success: true,
        message: Some("已请求取消模型下载。".to_string()),
        error: None,
        code: Some("cancelled".to_string()),
    })
}

/// Select a downloaded model and persist all backend-readable runtime settings.
#[tauri::command]
pub fn model_select(app: AppHandle, model_id: String) -> CommandResult<LocalModelSelection> {
    let spec = find_spec(&model_id)?;
    if !all_files_exist(&app, spec).map_err(CommandError::from_message)? {
        return Err(CommandError::configuration(
            "请先下载完整的本地 ASR 模型文件",
        ));
    }

    let mut settings_to_write: HashMap<String, String> = HashMap::new();
    settings_to_write.insert(
        "cloudTranscriptionProvider".to_string(),
        "local".to_string(),
    );
    settings_to_write.insert("cloudTranscriptionModel".to_string(), spec.id.to_string());
    settings_to_write.insert("localAsrRuntime".to_string(), spec.runtime.to_string());
    settings_to_write.insert("localAsrModelFamily".to_string(), spec.family.to_string());
    for file in spec.files {
        if file.setting_key.is_empty() {
            continue;
        }
        if let Some(value) = setting_value_for(&app, spec, file.setting_key) {
            settings_to_write.insert(file.setting_key.to_string(), value);
        }
    }
    if spec.tokenizer_dir.is_some() {
        if let Some(value) = setting_value_for(&app, spec, "localAsrTokenizerPath") {
            settings_to_write.insert("localAsrTokenizerPath".to_string(), value);
        }
    }

    for (key, value) in &settings_to_write {
        settings::set_setting_value(app.clone(), key.clone(), serde_json::json!(value))
            .map_err(CommandError::from_message)?;
    }

    Ok(LocalModelSelection {
        model_id: spec.id.to_string(),
        model_path: setting_value_for(&app, spec, "localAsrModelPath").unwrap_or_default(),
        projector_path: setting_value_for(&app, spec, "localAsrProjectorPath").unwrap_or_default(),
        runtime: spec.runtime.to_string(),
        model_family: spec.family.to_string(),
        settings: settings_to_write,
    })
}
