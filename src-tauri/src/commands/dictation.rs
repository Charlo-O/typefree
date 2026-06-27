#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(target_os = "macos")]
static NEXT_BACKEND_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[cfg(target_os = "macos")]
fn get_setting_string(app: &AppHandle, key: &str) -> Option<String> {
    super::settings::get_setting_value(app.clone(), key.to_string())
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
}

#[cfg(target_os = "macos")]
fn resolve_provider_model_language(app: &AppHandle) -> (String, Option<String>, Option<String>) {
    let provider = get_setting_string(app, "cloudTranscriptionProvider")
        .unwrap_or_else(|| "zai".to_string())
        .trim()
        .to_string();

    // Backend transcription only supports built-in providers.
    let provider = match provider.as_str() {
        "assemblyai" | "openai" | "groq" | "zai" | "volcengine" => provider,
        _ => "zai".to_string(),
    };

    let model = get_setting_string(app, "cloudTranscriptionModel").and_then(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    let language = get_setting_string(app, "preferredLanguage").and_then(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() || trimmed == "auto" {
            None
        } else {
            Some(trimmed)
        }
    });

    (provider, model, language)
}

#[cfg(target_os = "macos")]
const DEBOUNCE: Duration = Duration::from_millis(30);

#[cfg(target_os = "macos")]
const START_FEEDBACK_DELAY: Duration = Duration::from_millis(450);

#[cfg(target_os = "macos")]
const RECORDING_MAX_DURATION_DEFAULT_SECONDS: u64 = 300;
#[cfg(target_os = "macos")]
const RECORDING_MAX_DURATION_MIN_SECONDS: u64 = 15;
#[cfg(target_os = "macos")]
const RECORDING_MAX_DURATION_MAX_SECONDS: u64 = 3600;

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendDictationState {
    session_id: String,
    phase: &'static str,
    is_recording: bool,
    is_processing: bool,
    text: Option<String>,
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeline_events: Option<Vec<BackendTimelineEvent>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    post_processing_steps: Option<Vec<super::postprocessing::PostprocessStep>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    post_processing_timings: Option<super::postprocessing::PostprocessTimings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    processing_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    used_reasoning: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fallback_reason: Option<String>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendTimelineEvent {
    kind: &'static str,
    label: &'static str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<&'static str>,
    source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    meta: Option<serde_json::Value>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendDictationSessionPayload {
    session_id: String,
}

#[cfg(target_os = "macos")]
fn next_backend_session_id() -> String {
    let seq = NEXT_BACKEND_SESSION_ID.fetch_add(1, Ordering::Relaxed);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("backend-{now_ms}-{seq}")
}

#[cfg(target_os = "macos")]
fn emit_backend_state(
    app: &AppHandle,
    session_id: &str,
    phase: &'static str,
    is_recording: bool,
    is_processing: bool,
    text: Option<String>,
    error: Option<String>,
) {
    emit_backend_state_with_postprocessing(
        app,
        session_id,
        phase,
        is_recording,
        is_processing,
        text,
        error,
        None,
    );
}

#[cfg(target_os = "macos")]
fn emit_backend_state_with_postprocessing(
    app: &AppHandle,
    session_id: &str,
    phase: &'static str,
    is_recording: bool,
    is_processing: bool,
    text: Option<String>,
    error: Option<String>,
    postprocessing: Option<&super::postprocessing::PostprocessOutcome>,
) {
    emit_backend_state_with_timeline(
        app,
        session_id,
        phase,
        is_recording,
        is_processing,
        text,
        error,
        postprocessing,
        None,
    );
}

#[cfg(target_os = "macos")]
fn emit_backend_state_with_timeline(
    app: &AppHandle,
    session_id: &str,
    phase: &'static str,
    is_recording: bool,
    is_processing: bool,
    text: Option<String>,
    error: Option<String>,
    postprocessing: Option<&super::postprocessing::PostprocessOutcome>,
    timeline_events: Option<Vec<BackendTimelineEvent>>,
) {
    let timeline_events_for_db = timeline_events.clone().unwrap_or_default();
    persist_backend_timeline_events(
        app,
        session_id,
        phase,
        is_recording,
        is_processing,
        text.as_deref(),
        error.clone(),
        &timeline_events_for_db,
    );

    let _ = app.emit(
        "backend-dictation-state",
        BackendDictationState {
            session_id: session_id.to_string(),
            phase,
            is_recording,
            is_processing,
            text,
            error,
            timeline_events,
            post_processing_steps: postprocessing.map(|outcome| outcome.steps.clone()),
            post_processing_timings: postprocessing.map(|outcome| outcome.timings.clone()),
            processing_mode: postprocessing.map(|outcome| outcome.processing_mode.clone()),
            used_reasoning: postprocessing.map(|outcome| outcome.used_reasoning),
            fallback_reason: postprocessing.and_then(|outcome| outcome.fallback_reason.clone()),
        },
    );
}

#[cfg(target_os = "macos")]
fn elapsed_ms(started_at: Instant) -> u64 {
    started_at
        .elapsed()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(target_os = "macos")]
fn duration_seconds_to_ms(duration_seconds: Option<f64>) -> Option<u64> {
    duration_seconds
        .filter(|duration| duration.is_finite() && *duration >= 0.0)
        .map(|duration| (duration * 1000.0).round() as u64)
}

#[cfg(target_os = "macos")]
fn timeline_event(
    kind: &'static str,
    label: &'static str,
    status: &'static str,
    phase: Option<&'static str>,
    duration_ms: Option<u64>,
    detail: Option<String>,
    meta: Option<serde_json::Value>,
) -> BackendTimelineEvent {
    BackendTimelineEvent {
        kind,
        label,
        status,
        phase,
        source: "backend",
        duration_ms,
        detail,
        meta,
    }
}

#[cfg(target_os = "macos")]
fn backend_phase_kind(phase: &str) -> &'static str {
    match phase {
        "recording" => "state",
        "transcribing" => "transcription",
        "postprocessing" => "postprocessing",
        "inserting" => "insert",
        "completed" => "session",
        "failed" => "error",
        _ => "backend",
    }
}

#[cfg(target_os = "macos")]
fn backend_phase_label(phase: &str) -> &'static str {
    match phase {
        "recording" => "backend.recording",
        "transcribing" => "backend.transcribing",
        "postprocessing" => "backend.postprocessing",
        "inserting" => "backend.inserting",
        "completed" => "backend.completed",
        "failed" => "backend.failed",
        _ => "backend.state",
    }
}

#[cfg(target_os = "macos")]
fn backend_phase_status(phase: &str, has_error: bool) -> &'static str {
    if has_error || phase == "failed" {
        return "failed";
    }

    match phase {
        "completed" => "completed",
        "idle" => "info",
        _ => "started",
    }
}

#[cfg(target_os = "macos")]
fn timeline_duration_to_i64(duration_ms: Option<u64>) -> Option<i64> {
    duration_ms.map(|value| value.min(i64::MAX as u64) as i64)
}

#[cfg(target_os = "macos")]
fn timeline_event_to_db_input(
    event: &BackendTimelineEvent,
) -> super::database::DictationTimelineEventInput {
    super::database::DictationTimelineEventInput {
        kind: event.kind.to_string(),
        label: event.label.to_string(),
        status: Some(event.status.to_string()),
        phase: event.phase.map(|phase| phase.to_string()),
        source: Some(event.source.to_string()),
        duration_ms: timeline_duration_to_i64(event.duration_ms),
        detail: event.detail.clone(),
        meta: event.meta.clone(),
        at: None,
        elapsed_ms: None,
    }
}

#[cfg(target_os = "macos")]
fn persist_backend_timeline_events(
    app: &AppHandle,
    session_id: &str,
    phase: &'static str,
    is_recording: bool,
    is_processing: bool,
    text: Option<&str>,
    error: Option<String>,
    timeline_events: &[BackendTimelineEvent],
) {
    let mut events = Vec::with_capacity(timeline_events.len() + 1);
    events.push(super::database::DictationTimelineEventInput {
        kind: backend_phase_kind(phase).to_string(),
        label: backend_phase_label(phase).to_string(),
        status: Some(backend_phase_status(phase, error.is_some()).to_string()),
        phase: Some(phase.to_string()),
        source: Some("backend".to_string()),
        duration_ms: None,
        detail: error,
        meta: Some(serde_json::json!({
            "isRecording": is_recording,
            "isProcessing": is_processing,
            "hasText": text.map(|value| !value.is_empty()).unwrap_or(false),
            "outputTextLength": text.map(|value| value.chars().count()).unwrap_or(0),
        })),
        at: None,
        elapsed_ms: None,
    });
    events.extend(timeline_events.iter().map(timeline_event_to_db_input));

    if let Err(error) = super::database::db_save_dictation_timeline_events_value(
        app,
        session_id.to_string(),
        Some("backend".to_string()),
        events,
    ) {
        eprintln!("[dictation] failed to persist backend timeline: {error}");
    }
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
enum Command {
    Input {
        hotkey_string: String,
        is_pressed: bool,
        push_to_talk: bool,
    },
    MaxDurationElapsed {
        session_id: String,
    },
    ProcessingFinished {
        session_id: String,
    },
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
enum Stage {
    Idle,
    Recording,
    Processing,
}

/// Coordinates hotkey events so we don't race recording/transcription across threads.
#[cfg(target_os = "macos")]
struct DictationCoordinator {
    tx: tokio::sync::mpsc::UnboundedSender<Command>,
}

#[cfg(target_os = "macos")]
struct FinishGuard {
    tx: tokio::sync::mpsc::UnboundedSender<Command>,
    session_id: String,
}

#[cfg(target_os = "macos")]
impl Drop for FinishGuard {
    fn drop(&mut self) {
        let _ = self.tx.send(Command::ProcessingFinished {
            session_id: self.session_id.clone(),
        });
    }
}

#[cfg(target_os = "macos")]
impl DictationCoordinator {
    fn new(app: AppHandle) -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Command>();
        let tx_for_tasks = tx.clone();

        tauri::async_runtime::spawn(async move {
            let mut stage = Stage::Idle;
            let mut current_session_id: Option<String> = None;
            let mut processing_session_id: Option<String> = None;
            let mut last_press: Option<Instant> = None;

            while let Some(cmd) = rx.recv().await {
                match cmd {
                    Command::Input {
                        hotkey_string,
                        is_pressed,
                        push_to_talk,
                    } => {
                        // Keep our stage in sync with the actual recorder state (UI can start/stop too).
                        let recording_active = super::recording::is_native_recording_active();
                        match (&stage, recording_active) {
                            (Stage::Idle, true) => stage = Stage::Recording,
                            (Stage::Recording, false) => {
                                stage = Stage::Idle;
                                current_session_id = None;
                            }
                            _ => {}
                        }

                        // Debounce rapid-fire press events (key repeat / double-tap).
                        // Releases always pass through for push-to-talk.
                        if is_pressed {
                            let now = Instant::now();
                            if last_press.map_or(false, |t| now.duration_since(t) < DEBOUNCE) {
                                eprintln!(
                                    "[dictation] debounced press for '{}' (stage={:?})",
                                    hotkey_string, stage
                                );
                                continue;
                            }
                            last_press = Some(now);
                        }

                        if push_to_talk {
                            if is_pressed && matches!(stage, Stage::Idle) {
                                eprintln!(
                                    "[dictation] start (push-to-talk) via '{}'",
                                    hotkey_string
                                );
                                let session_id = next_backend_session_id();
                                if let Err(err) = start_recording(
                                    &app,
                                    &session_id,
                                    "hotkey.start",
                                    Some(hotkey_string.clone()),
                                )
                                .await
                                {
                                    eprintln!("[dictation] start failed: {}", err);
                                    emit_backend_state(
                                        &app,
                                        &session_id,
                                        "failed",
                                        false,
                                        false,
                                        None,
                                        Some(err.clone()),
                                    );
                                } else {
                                    arm_recording_max_duration(
                                        &app,
                                        tx_for_tasks.clone(),
                                        &session_id,
                                    );
                                    current_session_id = Some(session_id);
                                    stage = Stage::Recording;
                                }
                            } else if !is_pressed && matches!(stage, Stage::Recording) {
                                eprintln!(
                                    "[dictation] stop (push-to-talk) via '{}'",
                                    hotkey_string
                                );
                                stage = Stage::Processing;
                                let session_id = current_session_id
                                    .take()
                                    .unwrap_or_else(next_backend_session_id);
                                processing_session_id = Some(session_id.clone());
                                stop_and_transcribe(
                                    app.clone(),
                                    tx_for_tasks.clone(),
                                    session_id,
                                    "hotkey.stop",
                                    Some(hotkey_string.clone()),
                                );
                            }
                        } else if is_pressed {
                            match stage {
                                Stage::Idle => {
                                    eprintln!("[dictation] start (tap) via '{}'", hotkey_string);
                                    let session_id = next_backend_session_id();
                                    if let Err(err) = start_recording(
                                        &app,
                                        &session_id,
                                        "hotkey.toggle",
                                        Some(hotkey_string.clone()),
                                    )
                                    .await
                                    {
                                        eprintln!("[dictation] start failed: {}", err);
                                        emit_backend_state(
                                            &app,
                                            &session_id,
                                            "failed",
                                            false,
                                            false,
                                            None,
                                            Some(err.clone()),
                                        );
                                    } else {
                                        arm_recording_max_duration(
                                            &app,
                                            tx_for_tasks.clone(),
                                            &session_id,
                                        );
                                        current_session_id = Some(session_id);
                                        stage = Stage::Recording;
                                    }
                                }
                                Stage::Recording => {
                                    eprintln!("[dictation] stop (tap) via '{}'", hotkey_string);
                                    stage = Stage::Processing;
                                    let session_id = current_session_id
                                        .take()
                                        .unwrap_or_else(next_backend_session_id);
                                    processing_session_id = Some(session_id.clone());
                                    stop_and_transcribe(
                                        app.clone(),
                                        tx_for_tasks.clone(),
                                        session_id,
                                        "hotkey.toggle",
                                        Some(hotkey_string.clone()),
                                    );
                                }
                                Stage::Processing => {
                                    eprintln!(
                                        "[dictation] ignoring press while processing via '{}'",
                                        hotkey_string
                                    );
                                }
                            }
                        }
                    }
                    Command::MaxDurationElapsed { session_id } => {
                        if matches!(stage, Stage::Recording)
                            && current_session_id.as_deref() == Some(session_id.as_str())
                        {
                            eprintln!(
                                "[dictation] max recording duration elapsed for session {}",
                                session_id
                            );
                            stage = Stage::Processing;
                            let session_id = current_session_id.take().unwrap_or(session_id);
                            processing_session_id = Some(session_id.clone());
                            stop_and_transcribe(
                                app.clone(),
                                tx_for_tasks.clone(),
                                session_id,
                                "recording.max-duration",
                                None,
                            );
                        }
                    }
                    Command::ProcessingFinished { session_id } => {
                        if matches!(stage, Stage::Processing)
                            && processing_session_id.as_deref() == Some(session_id.as_str())
                        {
                            stage = Stage::Idle;
                            processing_session_id = None;
                        } else {
                            eprintln!(
                                "[dictation] ignoring stale processing completion for session {} (stage={:?}, active_processing_session={:?})",
                                session_id, stage, processing_session_id
                            );
                        }
                    }
                }
            }
        });

        Self { tx }
    }

    fn send_input(&self, hotkey_string: &str, is_pressed: bool, push_to_talk: bool) {
        let _ = self.tx.send(Command::Input {
            hotkey_string: hotkey_string.to_string(),
            is_pressed,
            push_to_talk,
        });
    }
}

#[cfg(target_os = "macos")]
fn is_push_to_talk(app: &AppHandle) -> bool {
    get_setting_string(app, "activationMode")
        .map(|mode| mode.trim().eq_ignore_ascii_case("push"))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn get_setting_number(app: &AppHandle, key: &str) -> Option<f64> {
    super::settings::get_setting_value(app.clone(), key.to_string())
        .ok()
        .flatten()
        .and_then(|value| {
            value.as_f64().or_else(|| {
                value
                    .as_str()
                    .and_then(|text| text.trim().parse::<f64>().ok())
            })
        })
}

#[cfg(target_os = "macos")]
fn recording_max_duration(app: &AppHandle) -> Option<Duration> {
    let raw_seconds = get_setting_number(app, "recordingMaxDurationSeconds")
        .unwrap_or(RECORDING_MAX_DURATION_DEFAULT_SECONDS as f64);
    if raw_seconds <= 0.0 {
        return None;
    }

    let seconds = raw_seconds.round().clamp(
        RECORDING_MAX_DURATION_MIN_SECONDS as f64,
        RECORDING_MAX_DURATION_MAX_SECONDS as f64,
    ) as u64;
    Some(Duration::from_secs(seconds))
}

#[cfg(target_os = "macos")]
fn arm_recording_max_duration(
    app: &AppHandle,
    tx: tokio::sync::mpsc::UnboundedSender<Command>,
    session_id: &str,
) {
    let Some(duration) = recording_max_duration(app) else {
        return;
    };
    let session_id = session_id.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(duration).await;
        let _ = tx.send(Command::MaxDurationElapsed { session_id });
    });
}

#[cfg(target_os = "macos")]
async fn start_recording(
    app: &AppHandle,
    session_id: &str,
    trigger_label: &'static str,
    trigger_detail: Option<String>,
) -> Result<(), String> {
    let started_at = Instant::now();
    match super::window::sync_foreground_application_vocabulary(app.clone()) {
        Ok(Some(application)) => {
            eprintln!(
                "[dictation] foreground application synced: {} ({})",
                application.id, application.name
            );
        }
        Ok(None) => {
            eprintln!("[dictation] foreground application unavailable");
        }
        Err(err) => {
            eprintln!("[dictation] failed to sync foreground application: {}", err);
        }
    }

    crate::overlay::show_recording_overlay(app, crate::overlay::OverlayState::Recording);

    let _ = app.emit(
        "backend-dictation-start-feedback",
        BackendDictationSessionPayload {
            session_id: session_id.to_string(),
        },
    );
    tokio::time::sleep(START_FEEDBACK_DELAY).await;

    if let Err(err) = super::audio_ducking::start_system_mute(app) {
        eprintln!("[dictation] failed to mute system audio: {}", err);
    }

    let started = match super::recording::start_native_recording().await {
        Ok(started) => started,
        Err(err) => {
            let _ = super::audio_ducking::stop_system_mute(app);
            crate::overlay::hide_recording_overlay(app);
            return Err(err.to_string());
        }
    };
    if !started {
        let _ = super::audio_ducking::stop_system_mute(app);
        crate::overlay::hide_recording_overlay(app);
        return Err("Failed to start native recording".to_string());
    }

    emit_backend_state_with_timeline(
        app,
        session_id,
        "recording",
        true,
        false,
        None,
        None,
        None,
        Some(vec![
            timeline_event(
                "input",
                trigger_label,
                "completed",
                None,
                None,
                trigger_detail,
                None,
            ),
            timeline_event(
                "state",
                "recording.started",
                "started",
                Some("recording"),
                Some(elapsed_ms(started_at)),
                None,
                None,
            ),
        ]),
    );
    Ok(())
}

#[cfg(target_os = "macos")]
fn stop_and_transcribe(
    app: AppHandle,
    tx: tokio::sync::mpsc::UnboundedSender<Command>,
    session_id: String,
    stop_label: &'static str,
    stop_detail: Option<String>,
) {
    tauri::async_runtime::spawn(async move {
        let _guard = FinishGuard {
            tx,
            session_id: session_id.clone(),
        };

        let stop_started_at = Instant::now();
        let result = match super::recording::stop_native_recording().await {
            Ok(result) => result,
            Err(err) => {
                let _ = super::audio_ducking::stop_system_mute(&app);
                emit_backend_state(
                    &app,
                    &session_id,
                    "failed",
                    false,
                    false,
                    None,
                    Some(err.to_string()),
                );
                crate::overlay::hide_recording_overlay(&app);
                return;
            }
        };
        let recording_duration_ms = duration_seconds_to_ms(result.duration_seconds);
        let recording_bytes = result.audio_data.len();
        let _ = super::audio_ducking::stop_system_mute(&app);
        emit_backend_state_with_timeline(
            &app,
            &session_id,
            "transcribing",
            false,
            true,
            None,
            None,
            None,
            Some(vec![
                timeline_event(
                    "input",
                    stop_label,
                    "completed",
                    None,
                    None,
                    stop_detail,
                    None,
                ),
                timeline_event(
                    "state",
                    "recording.stopped",
                    "completed",
                    Some("transcribing"),
                    Some(elapsed_ms(stop_started_at)),
                    None,
                    Some(serde_json::json!({
                        "audioBytes": recording_bytes,
                        "recordingDurationMs": recording_duration_ms,
                    })),
                ),
            ]),
        );
        crate::overlay::show_recording_overlay(&app, crate::overlay::OverlayState::Transcribing);

        let audio_quality_started_at = Instant::now();
        let prepared = match super::audio_quality::prepare_native_recording(&app, result) {
            Ok(prepared) => {
                if prepared.processed {
                    eprintln!(
                        "[dictation] native audio quality preprocessing applied for session {}",
                        session_id
                    );
                }
                prepared
            }
            Err(err) => {
                emit_backend_state(
                    &app,
                    &session_id,
                    "failed",
                    false,
                    false,
                    None,
                    Some(err),
                );
                crate::overlay::hide_recording_overlay(&app);
                return;
            }
        };
        let audio_quality_duration_ms = elapsed_ms(audio_quality_started_at);
        let audio_quality_processed = prepared.processed;
        let result = prepared.result;
        let prepared_audio_bytes = result.audio_data.len();
        let prepared_audio_duration_ms = duration_seconds_to_ms(result.duration_seconds);
        emit_backend_state_with_timeline(
            &app,
            &session_id,
            "transcribing",
            false,
            true,
            None,
            None,
            None,
            Some(vec![timeline_event(
                "backend",
                if audio_quality_processed {
                    "audio-quality.completed"
                } else {
                    "audio-quality.skipped"
                },
                if audio_quality_processed {
                    "completed"
                } else {
                    "skipped"
                },
                Some("transcribing"),
                Some(audio_quality_duration_ms),
                None,
                Some(serde_json::json!({
                    "processed": audio_quality_processed,
                    "inputBytes": recording_bytes,
                    "outputBytes": prepared_audio_bytes,
                    "inputDurationMs": recording_duration_ms,
                    "outputDurationMs": prepared_audio_duration_ms,
                })),
            )]),
        );

        let (provider, model, language) = resolve_provider_model_language(&app);
        let transcription_started_at = Instant::now();
        let audio_data = result.audio_data;
        let raw_text = match super::transcription::transcribe_audio(
            app.clone(),
            audio_data,
            provider.clone(),
            model.clone(),
            language.clone(),
            Some(session_id.clone()),
            None,
        )
        .await
        {
            Ok(text) => text,
            Err(err) => {
                emit_backend_state(
                    &app,
                    &session_id,
                    "failed",
                    false,
                    false,
                    None,
                    Some(err.to_string()),
                );
                crate::overlay::hide_recording_overlay(&app);
                return;
            }
        };
        let transcription_duration_ms = elapsed_ms(transcription_started_at);
        crate::overlay::show_recording_overlay(&app, crate::overlay::OverlayState::Processing);
        emit_backend_state_with_timeline(
            &app,
            &session_id,
            "postprocessing",
            false,
            true,
            None,
            None,
            None,
            Some(vec![timeline_event(
                "transcription",
                "transcription.completed",
                "completed",
                Some("postprocessing"),
                Some(transcription_duration_ms),
                None,
                Some(serde_json::json!({
                    "provider": provider.clone(),
                    "model": model.clone(),
                    "language": language.clone(),
                    "inputBytes": prepared_audio_bytes,
                    "inputDurationMs": prepared_audio_duration_ms,
                    "outputTextLength": raw_text.trim().len(),
                })),
            )]),
        );
        let postprocessing_started_at = Instant::now();
        let outcome =
            super::postprocessing::postprocess_transcription(app.clone(), raw_text.clone()).await;
        let postprocessing_duration_ms = elapsed_ms(postprocessing_started_at);
        let metadata_json = serde_json::to_string(&serde_json::json!({
            "processingMode": outcome.processing_mode.clone(),
            "usedReasoning": outcome.used_reasoning,
            "fallbackReason": outcome.fallback_reason.clone(),
            "steps": outcome.steps.clone(),
            "timings": outcome.timings.clone(),
        }))
        .ok();
        emit_backend_state_with_timeline(
            &app,
            &session_id,
            "inserting",
            false,
            true,
            None,
            None,
            None,
            Some(vec![
                timeline_event(
                    "postprocessing",
                    "postprocessing.completed",
                    "completed",
                    Some("inserting"),
                    Some(postprocessing_duration_ms),
                    None,
                    Some(serde_json::json!({
                        "processingMode": outcome.processing_mode.clone(),
                        "usedReasoning": outcome.used_reasoning,
                        "fallbackReason": outcome.fallback_reason.clone(),
                        "stepCount": outcome.steps.len(),
                    })),
                ),
                timeline_event(
                    "insert",
                    "insert.started",
                    "started",
                    Some("inserting"),
                    None,
                    None,
                    None,
                ),
            ]),
        );
        let paste_started_at = Instant::now();
        if let Err(err) = super::clipboard::paste_text(app.clone(), outcome.text.clone()) {
            let message = err.message.clone();
            emit_backend_state_with_timeline(
                &app,
                &session_id,
                "failed",
                false,
                false,
                None,
                Some(message),
                None,
                Some(vec![timeline_event(
                    "insert",
                    "insert.failed",
                    "failed",
                    Some("failed"),
                    Some(elapsed_ms(paste_started_at)),
                    Some(err.message.clone()),
                    None,
                )]),
            );
            crate::overlay::hide_recording_overlay(&app);
            return;
        }
        let paste_duration_ms = elapsed_ms(paste_started_at);
        emit_backend_state_with_timeline(
            &app,
            &session_id,
            "inserting",
            false,
            true,
            None,
            None,
            None,
            Some(vec![timeline_event(
                "insert",
                "insert.completed",
                "completed",
                Some("inserting"),
                Some(paste_duration_ms),
                None,
                Some(serde_json::json!({
                    "outputTextLength": outcome.text.trim().len(),
                })),
            )]),
        );

        let history_started_at = Instant::now();
        if let Err(err) = super::database::db_save_transcription_record_value(
            &app,
            super::database::SaveTranscriptionRecordRequest {
                text: raw_text,
                processed: Some(outcome.text.clone()),
                method: Some(outcome.method.clone()),
                agent_name: None,
                session_id: Some(session_id.clone()),
                provider: Some(provider.clone()),
                model: model.clone(),
                language: language.clone(),
                status: Some("completed".to_string()),
                error: None,
                outputs: Some(vec![super::database::TranscriptionOutputInput {
                    stage: "postprocessing".to_string(),
                    text: outcome.text.clone(),
                    metadata_json,
                }]),
            },
        ) {
            let message = format!("Dictation history save failed for session {session_id}: {err}");
            eprintln!("[dictation] {message}");
            emit_backend_state_with_timeline(
                &app,
                &session_id,
                "failed",
                false,
                false,
                Some(outcome.text.clone()),
                Some(message),
                None,
                Some(vec![timeline_event(
                    "history",
                    "history.db.failed",
                    "failed",
                    Some("failed"),
                    Some(elapsed_ms(history_started_at)),
                    Some(err),
                    None,
                )]),
            );
            crate::overlay::hide_recording_overlay(&app);
            return;
        }
        let history_duration_ms = elapsed_ms(history_started_at);

        emit_backend_state_with_timeline(
            &app,
            &session_id,
            "completed",
            false,
            false,
            Some(outcome.text.clone()),
            None,
            Some(&outcome),
            Some(vec![timeline_event(
                "history",
                "history.db.completed",
                "completed",
                Some("completed"),
                Some(history_duration_ms),
                None,
                Some(serde_json::json!({
                    "provider": provider.clone(),
                    "model": model.clone(),
                    "language": language.clone(),
                    "processingMode": outcome.processing_mode.clone(),
                    "usedReasoning": outcome.used_reasoning,
                })),
            )]),
        );
        crate::overlay::hide_recording_overlay(&app);
    });
}

#[cfg(target_os = "macos")]
pub fn init_dictation_coordinator(app: &AppHandle) {
    if app.try_state::<DictationCoordinator>().is_some() {
        return;
    }
    app.manage(DictationCoordinator::new(app.clone()));
}

/// Called by the global-hotkey callback. Keep this fast and non-panicking.
#[cfg(target_os = "macos")]
pub fn handle_hotkey_event(
    app: AppHandle,
    hotkey_string: String,
    is_pressed: bool,
    push_to_talk_override: Option<bool>,
) {
    if app.try_state::<DictationCoordinator>().is_none() {
        init_dictation_coordinator(&app);
    }
    let push_to_talk = push_to_talk_override.unwrap_or_else(|| is_push_to_talk(&app));
    if let Some(coordinator) = app.try_state::<DictationCoordinator>() {
        coordinator.send_input(&hotkey_string, is_pressed, push_to_talk);
    } else {
        eprintln!("[dictation] coordinator unavailable");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn init_dictation_coordinator(_app: &AppHandle) {
    // no-op
}
