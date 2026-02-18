use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

fn get_setting_string(app: &AppHandle, key: &str) -> Option<String> {
    super::settings::get_setting(app.clone(), key.to_string())
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
        "openai" | "groq" | "zai" => provider,
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
#[derive(Debug)]
enum Command {
    Input {
        hotkey_string: String,
        is_pressed: bool,
        push_to_talk: bool,
    },
    ProcessingFinished,
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
}

#[cfg(target_os = "macos")]
impl Drop for FinishGuard {
    fn drop(&mut self) {
        let _ = self.tx.send(Command::ProcessingFinished);
    }
}

#[cfg(target_os = "macos")]
impl DictationCoordinator {
    fn new(app: AppHandle) -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Command>();
        let tx_for_tasks = tx.clone();

        tauri::async_runtime::spawn(async move {
            let mut stage = Stage::Idle;
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
                            (Stage::Recording, false) => stage = Stage::Idle,
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
                                if let Err(err) = start_recording(&app).await {
                                    eprintln!("[dictation] start failed: {}", err);
                                    let _ = app.emit("backend-dictation-error", err);
                                } else {
                                    stage = Stage::Recording;
                                }
                            } else if !is_pressed && matches!(stage, Stage::Recording) {
                                eprintln!(
                                    "[dictation] stop (push-to-talk) via '{}'",
                                    hotkey_string
                                );
                                stage = Stage::Processing;
                                stop_and_transcribe(app.clone(), tx_for_tasks.clone());
                            }
                        } else if is_pressed {
                            match stage {
                                Stage::Idle => {
                                    eprintln!("[dictation] start (tap) via '{}'", hotkey_string);
                                    if let Err(err) = start_recording(&app).await {
                                        eprintln!("[dictation] start failed: {}", err);
                                        let _ = app.emit("backend-dictation-error", err);
                                    } else {
                                        stage = Stage::Recording;
                                    }
                                }
                                Stage::Recording => {
                                    eprintln!("[dictation] stop (tap) via '{}'", hotkey_string);
                                    stage = Stage::Processing;
                                    stop_and_transcribe(app.clone(), tx_for_tasks.clone());
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
                    Command::ProcessingFinished => {
                        stage = Stage::Idle;
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
async fn start_recording(app: &AppHandle) -> Result<(), String> {
    crate::overlay::show_recording_overlay(app, crate::overlay::OverlayState::Recording);

    let started = super::recording::start_native_recording().await?;
    if !started {
        crate::overlay::hide_recording_overlay(app);
        return Err("Failed to start native recording".to_string());
    }

    let _ = app.emit("backend-dictation-processing", false);
    let _ = app.emit("backend-dictation-recording", true);
    Ok(())
}

#[cfg(target_os = "macos")]
fn stop_and_transcribe(app: AppHandle, tx: tokio::sync::mpsc::UnboundedSender<Command>) {
    tauri::async_runtime::spawn(async move {
        let _guard = FinishGuard { tx };

        let _ = app.emit("backend-dictation-recording", false);
        let _ = app.emit("backend-dictation-processing", true);
        crate::overlay::show_recording_overlay(&app, crate::overlay::OverlayState::Transcribing);

        let result = match super::recording::stop_native_recording().await {
            Ok(result) => result,
            Err(err) => {
                let _ = app.emit("backend-dictation-processing", false);
                let _ = app.emit("backend-dictation-error", err.clone());
                crate::overlay::hide_recording_overlay(&app);
                return;
            }
        };

        let (provider, model, language) = resolve_provider_model_language(&app);
        let text = match super::transcription::transcribe_audio(
            app.clone(),
            result.audio_data,
            provider,
            model,
            language,
        )
        .await
        {
            Ok(text) => text,
            Err(err) => {
                let _ = app.emit("backend-dictation-processing", false);
                let _ = app.emit("backend-dictation-error", err.clone());
                crate::overlay::hide_recording_overlay(&app);
                return;
            }
        };

        crate::overlay::show_recording_overlay(&app, crate::overlay::OverlayState::Processing);

        if let Err(err) = super::clipboard::paste_text(app.clone(), text.clone()) {
            let _ = app.emit("backend-dictation-processing", false);
            let _ = app.emit("backend-dictation-error", err);
            crate::overlay::hide_recording_overlay(&app);
            return;
        }

        let _ = super::database::db_save_transcription(app.clone(), text.clone(), None, None, None);
        let _ = app.emit("backend-dictation-result", text);

        let _ = app.emit("backend-dictation-processing", false);
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
pub fn handle_hotkey_event(app: AppHandle, hotkey_string: String, is_pressed: bool) {
    if app.try_state::<DictationCoordinator>().is_none() {
        init_dictation_coordinator(&app);
    }
    let push_to_talk = is_push_to_talk(&app);
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

#[cfg(not(target_os = "macos"))]
pub fn handle_hotkey_event(_app: AppHandle, _hotkey_string: String, _is_pressed: bool) {
    // no-op
}
