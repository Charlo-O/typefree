use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::Url;
use serde::Serialize;
use tauri::AppHandle;
use tokio::fs;
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

use crate::commands::command_error::{CommandError, CommandResult};
use crate::commands::settings;
use crate::transcription::domain::{
    emit_transcript_event, TranscriptEvent, BATCH_TRANSCRIPT_EVENT_NAME,
};

#[cfg(feature = "local-asr-sherpa")]
use super::audio::decode_wav_to_16k_mono;
use super::manifest::{
    LocalAsrModelFormat, LocalAsrModelManifest, LocalAsrRequest, LocalAsrRuntime,
};

use super::llama;
#[cfg(feature = "local-asr-sherpa")]
use super::sherpa::{
    recognize_paraformer, recognize_qwen3_asr, recognize_sense_voice, recognize_whisper,
};

const LOCAL_ASR_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Debug)]
struct LocalAsrSettings {
    runtime: String,
    endpoint: String,
    model_path: String,
    projector_path: String,
    executable_path: String,
    command_args: String,
    model_family: String,
    tokens_path: String,
    encoder_path: String,
    decoder_path: String,
    joiner_path: String,
    conv_frontend_path: String,
    tokenizer_path: String,
    #[allow(dead_code)]
    num_threads: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAsrRuntimeStatus {
    pub available: bool,
    pub runtime: String,
    pub model_ready: bool,
    pub reason: String,
}

impl LocalAsrSettings {
    fn runtime_id(&self) -> &str {
        self.runtime.trim()
    }

    fn family_id(&self) -> &str {
        self.model_family.trim()
    }

    fn manifest(&self, family: String) -> LocalAsrModelManifest {
        let runtime = runtime_kind(self.runtime_id());
        let normalized_family = normalize_family(&family);
        let model_path = if self.model_path.trim().is_empty()
            && matches!(normalized_family.as_str(), "whisper" | "qwen3asr")
        {
            self.encoder_path.clone()
        } else {
            self.model_path.clone()
        };
        LocalAsrModelManifest {
            id: family.clone(),
            display_name: family,
            runtime,
            format: if matches!(
                runtime,
                LocalAsrRuntime::ExternalCommand
                    | LocalAsrRuntime::WhisperCpp
                    | LocalAsrRuntime::R2t2Llama
                    | LocalAsrRuntime::OpenAiCompatible
            ) {
                LocalAsrModelFormat::Custom
            } else {
                LocalAsrModelFormat::Onnx
            },
            model_path,
            projector_path: non_empty(&self.projector_path),
            executable_path: non_empty(&self.executable_path),
            supports_streaming: false,
            languages: Vec::new(),
        }
    }
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn runtime_kind(value: &str) -> LocalAsrRuntime {
    match value.to_ascii_lowercase().as_str() {
        "sherpa" | "sherpa-onnx" | "sherpa_onnx" => LocalAsrRuntime::SherpaOnnx,
        "r2t2" | "r2t2-llama" | "llama.cpp" => LocalAsrRuntime::R2t2Llama,
        "whisper.cpp" | "whisper-cpp" => LocalAsrRuntime::WhisperCpp,
        "openai-compatible"
        | "openai_compatible"
        | "openai-compatible-http"
        | "openai_compatible_http" => LocalAsrRuntime::OpenAiCompatible,
        _ => LocalAsrRuntime::ExternalCommand,
    }
}

fn is_known_runtime(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "external"
            | "external-command"
            | "external_command"
            | "command"
            | "sherpa"
            | "sherpa-onnx"
            | "sherpa_onnx"
            | "r2t2"
            | "r2t2-llama"
            | "llama.cpp"
            | "whisper.cpp"
            | "whisper-cpp"
            | "openai-compatible"
            | "openai_compatible"
            | "openai-compatible-http"
            | "openai_compatible_http"
    )
}

fn setting_string(app: &AppHandle, key: &str) -> CommandResult<String> {
    Ok(settings::get_setting_value(app.clone(), key.to_string())?
        .and_then(|value| value.as_str().map(str::trim).map(str::to_string))
        .unwrap_or_default())
}

fn load_settings(app: &AppHandle) -> CommandResult<LocalAsrSettings> {
    let num_threads = setting_string(app, "localAsrNumThreads")?
        .parse::<i32>()
        .unwrap_or(1)
        .clamp(1, 64);
    Ok(LocalAsrSettings {
        runtime: setting_string(app, "localAsrRuntime")?,
        endpoint: setting_string(app, "localAsrEndpoint")?,
        model_path: setting_string(app, "localAsrModelPath")?,
        projector_path: setting_string(app, "localAsrProjectorPath")?,
        executable_path: setting_string(app, "localAsrExecutablePath")?,
        command_args: setting_string(app, "localAsrCommandArgs")?,
        model_family: setting_string(app, "localAsrModelFamily")?,
        tokens_path: setting_string(app, "localAsrTokensPath")?,
        encoder_path: setting_string(app, "localAsrEncoderPath")?,
        decoder_path: setting_string(app, "localAsrDecoderPath")?,
        joiner_path: setting_string(app, "localAsrJoinerPath")?,
        conv_frontend_path: setting_string(app, "localAsrConvFrontendPath")?,
        tokenizer_path: setting_string(app, "localAsrTokenizerPath")?,
        num_threads,
    })
}

fn path_ready(path: &str) -> bool {
    !path.trim().is_empty() && Path::new(path).is_file()
}

fn missing_path_message(label: &str, path: &str) -> String {
    if path.trim().is_empty() {
        format!("{label} is not configured")
    } else {
        format!("{label} does not exist: {path}")
    }
}

fn check_settings(config: &LocalAsrSettings) -> LocalAsrRuntimeStatus {
    let runtime = config.runtime_id().to_string();
    if runtime.is_empty() {
        return LocalAsrRuntimeStatus {
            available: false,
            runtime,
            model_ready: false,
            reason: "localAsrRuntime is not configured".to_string(),
        };
    }
    if !is_known_runtime(&runtime) {
        return LocalAsrRuntimeStatus {
            available: false,
            runtime,
            model_ready: false,
            reason: "unknown local ASR runtime".to_string(),
        };
    }

    match runtime_kind(&runtime) {
        LocalAsrRuntime::ExternalCommand | LocalAsrRuntime::WhisperCpp => {
            let executable_ready = path_ready(&config.executable_path);
            LocalAsrRuntimeStatus {
                available: executable_ready,
                runtime,
                model_ready: true,
                reason: if executable_ready {
                    "external local ASR executable is ready".to_string()
                } else {
                    missing_path_message("local ASR executable", &config.executable_path)
                },
            }
        }
        LocalAsrRuntime::R2t2Llama => {
            let model_ready = path_ready(&config.model_path) && path_ready(&config.projector_path);
            let reason = if model_ready {
                "llama.cpp native GGUF and audio projector are ready".to_string()
            } else if !path_ready(&config.model_path) {
                missing_path_message("local ASR llama.cpp model", &config.model_path)
            } else {
                missing_path_message(
                    "local ASR llama.cpp audio projector",
                    &config.projector_path,
                )
            };
            LocalAsrRuntimeStatus {
                available: model_ready,
                runtime,
                model_ready,
                reason,
            }
        }
        LocalAsrRuntime::SherpaOnnx => {
            let family = normalize_family(config.family_id());
            let (model_ready, configured_reason) = match family.as_str() {
                "sensevoice" | "paraformer" => {
                    let ready = path_ready(&config.model_path);
                    (
                        ready,
                        if ready {
                            format!("sherpa-onnx {family} model is ready")
                        } else {
                            missing_path_message("local ASR model", &config.model_path)
                        },
                    )
                }
                "whisper" => {
                    let ready =
                        path_ready(&config.encoder_path) && path_ready(&config.decoder_path);
                    (
                        ready,
                        if ready {
                            "sherpa-onnx Whisper model is ready".to_string()
                        } else if !path_ready(&config.encoder_path) {
                            missing_path_message("local ASR Whisper encoder", &config.encoder_path)
                        } else {
                            missing_path_message("local ASR Whisper decoder", &config.decoder_path)
                        },
                    )
                }
                "qwen3asr" => {
                    let paths = [
                        (
                            "local ASR Qwen3 conv frontend",
                            config.conv_frontend_path.as_str(),
                        ),
                        ("local ASR Qwen3 encoder", config.encoder_path.as_str()),
                        ("local ASR Qwen3 decoder", config.decoder_path.as_str()),
                        ("local ASR Qwen3 tokenizer", config.tokenizer_path.as_str()),
                    ];
                    let first_missing = paths.iter().find(|(_, path)| !path_ready(path));
                    (
                        first_missing.is_none(),
                        match first_missing {
                            Some((label, path)) => missing_path_message(label, path),
                            None => "sherpa-onnx Qwen3-ASR model is ready".to_string(),
                        },
                    )
                }
                _ => (
                    false,
                    format!("unsupported sherpa-onnx model family: {family}"),
                ),
            };
            #[cfg(feature = "local-asr-sherpa")]
            let (available, reason) = (model_ready, configured_reason);
            #[cfg(not(feature = "local-asr-sherpa"))]
            let (available, reason) = (
                false,
                "sherpa-onnx support is disabled; rebuild with feature local-asr-sherpa"
                    .to_string(),
            );
            #[cfg(not(feature = "local-asr-sherpa"))]
            let _ = configured_reason;
            LocalAsrRuntimeStatus {
                available,
                runtime,
                model_ready,
                reason,
            }
        }
        LocalAsrRuntime::OpenAiCompatible => {
            let model_ready = !config.model_path.trim().is_empty();
            let endpoint_result = normalize_openai_compatible_endpoint(&config.endpoint);
            let (available, reason) = match (endpoint_result, model_ready) {
                (Ok(_), true) => (
                    true,
                    "OpenAI-compatible local ASR endpoint and model are configured (server probing is deferred until transcription)".to_string(),
                ),
                (Ok(_), false) => (
                    false,
                    "localAsrModelPath is not configured for the OpenAI-compatible runtime".to_string(),
                ),
                (Err(error), _) => (false, error),
            };
            LocalAsrRuntimeStatus {
                available,
                runtime,
                model_ready,
                reason,
            }
        }
    }
}

fn normalize_family(value: &str) -> String {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '_', ' '], "");
    if normalized.starts_with("sensevoice") {
        return "sensevoice".to_string();
    }
    if normalized.starts_with("paraformer") {
        return "paraformer".to_string();
    }
    if normalized.starts_with("whisper") {
        return "whisper".to_string();
    }
    if normalized.starts_with("qwen3asr") || normalized.starts_with("qwen3") {
        return "qwen3asr".to_string();
    }
    normalized
}

/// Check whether the configured local ASR runtime and model are ready.
#[tauri::command]
pub fn local_asr_check_runtime(app: AppHandle) -> CommandResult<LocalAsrRuntimeStatus> {
    let config = load_settings(&app)?;
    Ok(check_settings(&config))
}

/// Run one local ASR batch request using the configured runtime.
#[tauri::command]
pub async fn local_asr_transcribe(
    app: AppHandle,
    audio_data: Vec<u8>,
    model: Option<String>,
    language: Option<String>,
    session_id: Option<String>,
) -> CommandResult<String> {
    if audio_data.is_empty() {
        return Err(CommandError::configuration(
            "local ASR audio payload cannot be empty",
        ));
    }
    let config = load_settings(&app)?;
    if config.runtime_id().is_empty() {
        return Err(CommandError::configuration(
            "localAsrRuntime is not configured",
        ));
    }
    if !is_known_runtime(config.runtime_id()) {
        return Err(CommandError::configuration(format!(
            "unknown local ASR runtime: {}",
            config.runtime_id()
        )));
    }
    let family = model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(config.family_id())
        .to_string();
    let session_id = session_id.filter(|value| !value.trim().is_empty());
    let request = LocalAsrRequest {
        audio_data,
        model: config.manifest(family.clone()),
        language,
        session_id: session_id.clone(),
    };
    request.validate().map_err(CommandError::configuration)?;

    let result = match runtime_kind(config.runtime_id()) {
        LocalAsrRuntime::ExternalCommand | LocalAsrRuntime::WhisperCpp => timeout(
            LOCAL_ASR_TIMEOUT,
            run_external_command_async(config.clone(), request.clone()),
        )
        .await
        .map_err(|_| CommandError::timeout("local ASR timed out after 120 seconds"))?,
        LocalAsrRuntime::OpenAiCompatible => timeout(
            LOCAL_ASR_TIMEOUT,
            run_openai_compatible_async(config.clone(), request.clone()),
        )
        .await
        .map_err(|_| CommandError::timeout("local ASR timed out after 120 seconds"))?,
        _ => timeout(
            LOCAL_ASR_TIMEOUT,
            tokio::task::spawn_blocking(move || run_local_request(&config, &family, request)),
        )
        .await
        .map_err(|_| CommandError::timeout("local ASR timed out after 120 seconds"))?
        .map_err(|error| CommandError::from_message(error.to_string()))?,
    };
    let text = result.map_err(CommandError::from_message)?;

    if let Some(session_id) = session_id {
        emit_transcript_event(
            &app,
            BATCH_TRANSCRIPT_EVENT_NAME,
            TranscriptEvent::batch_final("local", session_id, text.clone()),
        );
    }
    Ok(text)
}

fn run_local_request(
    config: &LocalAsrSettings,
    family: &str,
    request: LocalAsrRequest,
) -> Result<String, String> {
    if !is_known_runtime(config.runtime_id()) {
        return Err(format!(
            "unknown local ASR runtime: {}",
            config.runtime_id()
        ));
    }
    let _ = (&config.tokens_path, &config.joiner_path);
    match runtime_kind(config.runtime_id()) {
        LocalAsrRuntime::ExternalCommand | LocalAsrRuntime::WhisperCpp => {
            Err("external local ASR must be executed through the async command path".to_string())
        }
        LocalAsrRuntime::R2t2Llama => llama::transcribe(
            Path::new(&config.model_path),
            Path::new(&config.projector_path),
            &request.audio_data,
            request.language.as_deref(),
            config.num_threads,
        ),
        LocalAsrRuntime::OpenAiCompatible => Err(
            "OpenAI-compatible local ASR must be executed through the async HTTP path".to_string(),
        ),
        LocalAsrRuntime::SherpaOnnx => {
            #[cfg(feature = "local-asr-sherpa")]
            {
                let samples = decode_wav_to_16k_mono(&request.audio_data)?;
                let family = normalize_family(family);
                match family.as_str() {
                    "sensevoice" => recognize_sense_voice(
                        Path::new(&config.model_path),
                        &samples,
                        request.language.as_deref(),
                        config.num_threads,
                    ),
                    "paraformer" => recognize_paraformer(
                        Path::new(&config.model_path),
                        &samples,
                        config.num_threads,
                    ),
                    "whisper" => recognize_whisper(
                        Path::new(&config.encoder_path),
                        Path::new(&config.decoder_path),
                        &samples,
                        request.language.as_deref(),
                        config.num_threads,
                    ),
                    "qwen3asr" => recognize_qwen3_asr(
                        Path::new(&config.conv_frontend_path),
                        Path::new(&config.encoder_path),
                        Path::new(&config.decoder_path),
                        Path::new(&config.tokenizer_path),
                        &samples,
                        config.num_threads,
                    ),
                    _ => Err(format!("unsupported sherpa-onnx model family: {family}")),
                }
            }
            #[cfg(not(feature = "local-asr-sherpa"))]
            {
                let _ = (family, request);
                Err(
                    "sherpa-onnx support is disabled; rebuild with feature local-asr-sherpa"
                        .to_string(),
                )
            }
        }
    }
}

fn is_private_endpoint_host(hostname: &str) -> bool {
    let host = hostname
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();

    if host == "localhost" || host == "0.0.0.0" || host.starts_with("127.") {
        return true;
    }
    if host == "::1" {
        return true;
    }
    if host.starts_with("10.") || host.starts_with("192.168.") || host.starts_with("169.254.") {
        return true;
    }
    if let Some(rest) = host.strip_prefix("172.") {
        if let Some(octet) = rest
            .split('.')
            .next()
            .and_then(|value| value.parse::<u8>().ok())
        {
            if (16..=31).contains(&octet) {
                return true;
            }
        }
    }
    if host.contains(':')
        && (host.starts_with("fe80") || host.starts_with("fc") || host.starts_with("fd"))
    {
        return true;
    }
    host.ends_with(".local")
}

fn normalize_openai_compatible_endpoint(raw: &str) -> Result<Url, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("localAsrEndpoint is not configured".to_string());
    }

    let mut endpoint = Url::parse(raw)
        .map_err(|_| "localAsrEndpoint must be a valid HTTP or HTTPS URL".to_string())?;
    let allowed = match endpoint.scheme() {
        "https" => true,
        "http" => endpoint.host_str().is_some_and(is_private_endpoint_host),
        _ => false,
    };
    if !allowed {
        return Err("localAsrEndpoint must use HTTPS or a private/local HTTP host".to_string());
    }

    let path = endpoint.path().trim_end_matches('/').to_string();
    if path.to_ascii_lowercase().ends_with("/audio/transcriptions") {
        endpoint.set_path(&path);
    } else {
        let next_path = if path.is_empty() {
            "/audio/transcriptions".to_string()
        } else {
            format!("{path}/audio/transcriptions")
        };
        endpoint.set_path(&next_path);
    }
    Ok(endpoint)
}

fn parse_openai_compatible_text(body: &[u8]) -> Result<String, String> {
    let output = String::from_utf8_lossy(body).trim().to_string();
    if output.is_empty() {
        return Err("OpenAI-compatible local ASR returned an empty response".to_string());
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&output) {
        for key in ["text", "transcript", "result"] {
            if let Some(text) = value.get(key).and_then(|item| item.as_str()) {
                let text = text.trim();
                if !text.is_empty() {
                    return Ok(text.to_string());
                }
            }
        }
        return Err(
            "OpenAI-compatible local ASR JSON response has no text, transcript, or result field"
                .to_string(),
        );
    }

    Ok(output)
}

async fn run_openai_compatible_async(
    config: LocalAsrSettings,
    request: LocalAsrRequest,
) -> Result<String, String> {
    let endpoint = normalize_openai_compatible_endpoint(&config.endpoint)?;
    let model = config.model_path.trim();
    if model.is_empty() {
        return Err(
            "localAsrModelPath is not configured for the OpenAI-compatible runtime".to_string(),
        );
    }

    let metadata =
        crate::transcription::domain::detect_audio_part_metadata(&request.audio_data, "wav");
    let part = reqwest::multipart::Part::bytes(request.audio_data)
        .file_name(format!("audio.{}", metadata.extension))
        .mime_str(metadata.mime_type)
        .map_err(|error| format!("failed to build local ASR audio part: {error}"))?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model.to_string());
    if let Some(language) = request
        .language
        .as_deref()
        .filter(|value| !value.trim().is_empty() && *value != "auto")
    {
        form = form.text("language", language.to_string());
    }

    let response = reqwest::Client::new()
        .post(endpoint)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("local ASR endpoint request failed: {error}"))?;
    let status = response.status();
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read local ASR response: {error}"))?;
    if !status.is_success() {
        let detail = String::from_utf8_lossy(&body).trim().to_string();
        return Err(if detail.is_empty() {
            format!("local ASR endpoint returned HTTP {status}")
        } else {
            format!("local ASR endpoint returned HTTP {status}: {detail}")
        });
    }
    parse_openai_compatible_text(&body)
}

fn unique_temp_wav() -> PathBuf {
    std::env::temp_dir().join(format!("typefree-local-asr-{}.wav", Uuid::new_v4()))
}

fn parse_external_text(stdout: &[u8]) -> Result<String, String> {
    let output = String::from_utf8_lossy(stdout).trim().to_string();
    if output.is_empty() {
        return Err("external local ASR returned empty output".to_string());
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&output) {
        for key in ["text", "transcript", "result"] {
            if let Some(text) = value.get(key).and_then(|item| item.as_str()) {
                let text = text.trim();
                if !text.is_empty() {
                    return Ok(text.to_string());
                }
            }
        }
        return Err("external local ASR JSON output has no text field".to_string());
    }
    Ok(output)
}

/// Split a user-provided argument string without invoking a shell.  This is
/// intentionally small but handles the quoting forms commonly used in
/// Windows/macOS/Linux paths.  The resulting tokens are passed directly to
/// `tokio::process::Command`, so shell metacharacters never get evaluated.
fn split_command_args(value: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for character in value.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            } else {
                current.push(character);
            }
            continue;
        }
        match character {
            '\'' | '"' => quote = Some(character),
            character if character.is_whitespace() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(character),
        }
    }

    if escaped {
        current.push('\\');
    }
    if quote.is_some() {
        return Err("local ASR command arguments contain an unmatched quote".to_string());
    }
    if !current.is_empty() {
        args.push(current);
    }
    Ok(args)
}

fn expand_command_arg(
    value: &str,
    wav_path: &Path,
    model_path: &str,
    projector_path: &str,
    language: Option<&str>,
) -> String {
    value
        .replace("{audio_file}", &wav_path.to_string_lossy())
        .replace("{model}", model_path)
        .replace("{projector}", projector_path)
        .replace("{language}", language.unwrap_or(""))
        .replace("{output_format}", "json")
}

async fn run_external_command_async(
    config: LocalAsrSettings,
    request: LocalAsrRequest,
) -> Result<String, String> {
    let executable = Path::new(&config.executable_path);
    if !executable.is_file() {
        return Err(missing_path_message(
            "local ASR executable",
            &config.executable_path,
        ));
    }

    let wav_path = unique_temp_wav();
    fs::write(&wav_path, &request.audio_data)
        .await
        .map_err(|error| format!("failed to write temporary local ASR WAV: {error}"))?;

    let mut command = Command::new(executable);
    command.kill_on_drop(true);
    let language = request
        .language
        .as_deref()
        .filter(|value| !value.trim().is_empty() && *value != "auto");
    if config.command_args.trim().is_empty() {
        command
            .arg("--audio-file")
            .arg(&wav_path)
            .arg("--output-format")
            .arg("json");
        if !config.model_path.trim().is_empty() {
            command.arg("--model").arg(&config.model_path);
        }
        if let Some(language) = language {
            command.arg("--language").arg(language);
        }
    } else {
        let args = split_command_args(&config.command_args)?;
        if args.is_empty() {
            return Err("local ASR command arguments are empty".to_string());
        }
        for argument in args {
            command.arg(expand_command_arg(
                &argument,
                &wav_path,
                &config.model_path,
                &config.projector_path,
                language,
            ));
        }
    }

    let output = command
        .output()
        .await
        .map_err(|error| format!("failed to launch local ASR executable: {error}"));
    let _ = fs::remove_file(&wav_path).await;
    let output = output?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("local ASR executable exited with status {}", output.status)
        } else {
            format!("local ASR executable failed: {stderr}")
        });
    }
    parse_external_text(&output.stdout)
}

#[cfg(test)]
mod tests {
    use super::{
        check_settings, expand_command_arg, normalize_family, normalize_openai_compatible_endpoint,
        parse_external_text, parse_openai_compatible_text, split_command_args, LocalAsrSettings,
    };
    use std::path::Path;

    fn defaults() -> LocalAsrSettings {
        LocalAsrSettings {
            runtime: "sherpa-onnx".to_string(),
            endpoint: String::new(),
            model_path: String::new(),
            projector_path: String::new(),
            executable_path: String::new(),
            command_args: String::new(),
            model_family: "sensevoice".to_string(),
            tokens_path: String::new(),
            encoder_path: String::new(),
            decoder_path: String::new(),
            joiner_path: String::new(),
            conv_frontend_path: String::new(),
            tokenizer_path: String::new(),
            num_threads: 1,
        }
    }

    #[test]
    fn normalizes_model_family_aliases() {
        assert_eq!(normalize_family("Sense-Voice"), "sensevoice");
        assert_eq!(normalize_family("whisper_cpp"), "whisper");
        assert_eq!(normalize_family("sensevoice-int8"), "sensevoice");
        assert_eq!(normalize_family("paraformer-zh"), "paraformer");
        assert_eq!(normalize_family("qwen3-asr"), "qwen3asr");
    }

    #[test]
    fn reports_missing_sherpa_model() {
        let status = check_settings(&defaults());
        assert!(!status.model_ready);
        assert!(!status.reason.is_empty());
    }

    #[test]
    fn parses_external_json_and_plain_output() {
        assert_eq!(
            parse_external_text(br#"{"text":"hello"}"#).expect("JSON text"),
            "hello"
        );
        assert_eq!(
            parse_external_text(b" plain transcript \n").expect("plain text"),
            "plain transcript"
        );
    }

    #[test]
    fn parses_and_expands_shell_free_external_command_arguments() {
        let args = split_command_args(
            r#"--model "{model}" --audio-file {audio_file} --language {language}"#,
        )
        .expect("quoted arguments should parse");
        assert_eq!(
            args,
            vec![
                "--model",
                "{model}",
                "--audio-file",
                "{audio_file}",
                "--language",
                "{language}"
            ]
        );

        let expanded = expand_command_arg(
            &args[1],
            Path::new(r#"C:\Temp\audio.wav"#),
            r#"C:\Models\r2t2.gguf"#,
            r#"C:\Models\mmproj.gguf"#,
            Some("zh"),
        );
        assert_eq!(expanded, r#"C:\Models\r2t2.gguf"#);
        assert_eq!(
            expand_command_arg(&args[3], Path::new(r#"C:\Temp\audio.wav"#), "", "", None,),
            r#"C:\Temp\audio.wav"#
        );
    }

    #[test]
    fn normalizes_openai_compatible_endpoint_paths() {
        assert_eq!(
            normalize_openai_compatible_endpoint("http://127.0.0.1:8080/v1")
                .expect("valid local endpoint")
                .as_str(),
            "http://127.0.0.1:8080/v1/audio/transcriptions"
        );
        assert_eq!(
            normalize_openai_compatible_endpoint("http://localhost:8080/v1/audio/transcriptions/")
                .expect("valid full endpoint")
                .as_str(),
            "http://localhost:8080/v1/audio/transcriptions"
        );
        assert!(normalize_openai_compatible_endpoint("http://example.com/v1").is_err());
    }

    #[test]
    fn parses_openai_compatible_response_aliases() {
        for (payload, expected) in [
            (br#"{"text":"hello"}"#.as_slice(), "hello"),
            (r#"{"transcript":"你好"}"#.as_bytes(), "你好"),
            (br#"{"result":"done"}"#.as_slice(), "done"),
        ] {
            assert_eq!(
                parse_openai_compatible_text(payload).expect("text field"),
                expected
            );
        }
        assert!(parse_openai_compatible_text(br#"{"ok":true}"#).is_err());
    }

    #[test]
    fn checks_openai_compatible_configuration_without_network_probe() {
        let mut config = defaults();
        config.runtime = "openai-compatible".to_string();
        config.endpoint = "http://127.0.0.1:8080/v1".to_string();
        config.model_path = "whisper-1".to_string();
        let status = check_settings(&config);
        assert!(status.available);
        assert!(status.model_ready);
    }
}
