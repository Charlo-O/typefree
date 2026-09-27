//! Native local-ASR model catalog and downloader.
//!
//! The catalog intentionally contains the model/projector pair required by
//! the in-process R2T2 llama.cpp adapter. Downloads are written to a `.part`
//! file and atomically renamed only after the complete response is received.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs::{self, File};
use tokio::io::AsyncWriteExt;

use crate::commands::command_error::{CommandError, CommandResult};
use crate::commands::settings;

const MODEL_PROGRESS_EVENT: &str = "model-download-progress";
const MODEL_ID: &str = "r2t2-native-q4";
const MODEL_DIR: &str = "confucius4-r2t2-q4";
const MODEL_FILE: &str = "Confucius4-R2T2-Q4_K_M.gguf";
const PROJECTOR_FILE: &str = "mmproj-Confucius4-R2T2-Q8_0.gguf";
const HF_BASE: &str = "https://huggingface.co/netease-youdao/Confucius4-R2T2-GGUF/resolve/main";
const MODEL_SIZE: u64 = 1_080_000_000;
const PROJECTOR_SIZE: u64 = 320_000_000;

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

#[derive(Clone, Debug)]
struct ModelFile {
    file_name: &'static str,
    expected_size: u64,
    url: String,
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
}

fn model_files() -> [ModelFile; 2] {
    [
        ModelFile {
            file_name: MODEL_FILE,
            expected_size: MODEL_SIZE,
            url: format!("{HF_BASE}/{MODEL_FILE}?download=true"),
        },
        ModelFile {
            file_name: PROJECTOR_FILE,
            expected_size: PROJECTOR_SIZE,
            url: format!("{HF_BASE}/{PROJECTOR_FILE}?download=true"),
        },
    ]
}

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("local-asr-models")
        .join(MODEL_DIR))
}

fn paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let dir = model_dir(app)?;
    Ok((dir.join(MODEL_FILE), dir.join(PROJECTOR_FILE)))
}

fn record(app: &AppHandle) -> Result<LocalModelRecord, String> {
    let (model_path, projector_path) = paths(app)?;
    let downloaded = model_path.is_file() && projector_path.is_file();
    Ok(LocalModelRecord {
        id: MODEL_ID.to_string(),
        name: "Confucius4-R2T2（原生 llama.cpp）".to_string(),
        size: "约 1.3 GB".to_string(),
        size_bytes: MODEL_SIZE + PROJECTOR_SIZE,
        description: "进程内 llama.cpp 音频 GGUF；下载后点击选择即可作为默认本地 ASR。".to_string(),
        file_name: MODEL_FILE.to_string(),
        quantization: "Q4_K_M + mmproj Q8_0".to_string(),
        context_length: 4096,
        hf_repo: "netease-youdao/Confucius4-R2T2-GGUF".to_string(),
        recommended: true,
        is_downloaded: downloaded,
        is_downloading: false,
        download_progress: if downloaded { 100 } else { 0 },
        downloaded,
        model_path: downloaded.then(|| model_path.to_string_lossy().to_string()),
        projector_path: downloaded.then(|| projector_path.to_string_lossy().to_string()),
        runtime: "llama.cpp".to_string(),
    })
}

fn invalid_model(model_id: &str) -> CommandError {
    CommandError::configuration(format!("unknown local ASR model: {model_id}"))
}

fn check_model_id(model_id: &str) -> Result<(), CommandError> {
    (model_id == MODEL_ID)
        .then_some(())
        .ok_or_else(|| invalid_model(model_id))
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
    file: &ModelFile,
    target: &Path,
    completed_before: u64,
    total_size: u64,
) -> Result<u64, String> {
    if target.is_file() {
        return Ok(file.expected_size);
    }

    let partial = target.with_extension(format!(
        "{}part",
        target.extension().and_then(|v| v.to_str()).unwrap_or("")
    ));
    let response = reqwest::Client::new()
        .get(&file.url)
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

/// Return the native local-ASR catalog and current download state.
#[tauri::command]
pub fn model_get_all(app: AppHandle) -> CommandResult<Vec<LocalModelRecord>> {
    Ok(vec![record(&app).map_err(CommandError::from_message)?])
}

#[tauri::command]
pub fn model_check(app: AppHandle, model_id: String) -> CommandResult<bool> {
    check_model_id(&model_id)?;
    Ok(record(&app).map_err(CommandError::from_message)?.downloaded)
}

/// Download the GGUF + audio projector pair using atomic temporary files.
#[tauri::command]
pub async fn model_download(app: AppHandle, model_id: String) -> CommandResult<ModelCommandResult> {
    check_model_id(&model_id)?;
    if let Ok(mut values) = cancellations().lock() {
        values.remove(&model_id);
    }
    let (model_path, projector_path) = paths(&app).map_err(CommandError::from_message)?;
    if let Some(parent) = model_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| CommandError::from_message(error.to_string()))?;
    }
    let files = model_files();
    let total_size = files.iter().map(|file| file.expected_size).sum::<u64>();
    let mut completed = 0u64;
    emit_progress(&app, &model_id, 0, 0, total_size);
    for (index, file) in files.iter().enumerate() {
        let target = if index == 0 {
            &model_path
        } else {
            &projector_path
        };
        completed = completed.saturating_add(
            download_file(&app, &model_id, file, target, completed, total_size)
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
    check_model_id(&model_id)?;
    let dir = model_dir(&app).map_err(CommandError::from_message)?;
    if dir.exists() {
        fs::remove_dir_all(dir)
            .await
            .map_err(|error| CommandError::from_message(error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn model_delete_all(app: AppHandle) -> CommandResult<ModelCommandResult> {
    let dir = model_dir(&app).map_err(CommandError::from_message)?;
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
    check_model_id(&model_id)?;
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
    check_model_id(&model_id)?;
    let (model_path, projector_path) = paths(&app).map_err(CommandError::from_message)?;
    if !model_path.is_file() || !projector_path.is_file() {
        return Err(CommandError::configuration(
            "请先下载完整的本地 ASR 模型和 audio projector",
        ));
    }

    let settings_to_write = [
        ("cloudTranscriptionProvider", serde_json::json!("local")),
        ("cloudTranscriptionModel", serde_json::json!(model_id)),
        ("localAsrRuntime", serde_json::json!("llama.cpp")),
        ("localAsrModelFamily", serde_json::json!("r2t2")),
        (
            "localAsrModelPath",
            serde_json::json!(model_path.to_string_lossy().to_string()),
        ),
        (
            "localAsrProjectorPath",
            serde_json::json!(projector_path.to_string_lossy().to_string()),
        ),
    ];
    for (key, value) in settings_to_write {
        settings::set_setting_value(app.clone(), key.to_string(), value)
            .map_err(CommandError::from_message)?;
    }

    Ok(LocalModelSelection {
        model_id,
        model_path: model_path.to_string_lossy().to_string(),
        projector_path: projector_path.to_string_lossy().to_string(),
        runtime: "llama.cpp".to_string(),
        model_family: "r2t2".to_string(),
    })
}
