use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SystemMuteState {
    backend: String,
    was_muted: bool,
    volume: Option<f32>,
}

static MUTE_STATE: Mutex<Option<SystemMuteState>> = Mutex::new(None);

const GUARD_FILE_NAME: &str = "audio_mute_guard.json";

fn guard_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.join(GUARD_FILE_NAME))
}

fn write_guard_file(app: &AppHandle, state: &SystemMuteState) -> Result<(), String> {
    let path = guard_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn read_guard_file(app: &AppHandle) -> Result<Option<SystemMuteState>, String> {
    let path = guard_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let state = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(state))
}

fn remove_guard_file(app: &AppHandle) {
    if let Ok(path) = guard_path(app) {
        let _ = fs::remove_file(path);
    }
}

fn mute_while_recording_enabled(app: &AppHandle) -> bool {
    super::settings::get_setting(app.clone(), "muteSystemAudioWhileRecording".to_string())
        .ok()
        .flatten()
        .and_then(|value| value.as_bool())
        .unwrap_or(true)
}

pub fn start_system_mute(app: &AppHandle) -> Result<(), String> {
    if !mute_while_recording_enabled(app) {
        return Ok(());
    }

    let mut guard = MUTE_STATE
        .lock()
        .map_err(|_| "Audio mute state lock is poisoned".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let state = platform::capture_state()?;
    write_guard_file(app, &state)?;

    if let Err(err) = platform::mute_system_audio() {
        remove_guard_file(app);
        return Err(err);
    }

    eprintln!(
        "[audio-mute] system output muted; was_muted={}, volume={:?}",
        state.was_muted, state.volume
    );
    *guard = Some(state);
    Ok(())
}

pub fn stop_system_mute(app: &AppHandle) -> Result<(), String> {
    let state = {
        let mut guard = MUTE_STATE
            .lock()
            .map_err(|_| "Audio mute state lock is poisoned".to_string())?;
        guard.take()
    }
    .or_else(|| read_guard_file(app).ok().flatten());

    let Some(state) = state else {
        remove_guard_file(app);
        return Ok(());
    };

    match platform::restore_system_audio(&state) {
        Ok(()) => {
            eprintln!(
                "[audio-mute] system output restored; was_muted={}, volume={:?}",
                state.was_muted, state.volume
            );
            remove_guard_file(app);
            Ok(())
        }
        Err(err) => {
            let _ = write_guard_file(app, &state);
            if let Ok(mut guard) = MUTE_STATE.lock() {
                *guard = Some(state);
            }
            Err(err)
        }
    }
}

pub fn recover_stale_mute(app: &AppHandle) {
    let Ok(Some(state)) = read_guard_file(app) else {
        return;
    };

    match platform::restore_system_audio(&state) {
        Ok(()) => {
            remove_guard_file(app);
            eprintln!("[audio-mute] recovered stale system output mute guard");
        }
        Err(err) => {
            eprintln!("[audio-mute] failed to recover stale mute guard: {err}");
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::ptr::null;

    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, S_FALSE, S_OK};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    use super::SystemMuteState;

    struct ComGuard {
        should_uninitialize: bool,
    }

    impl ComGuard {
        fn initialize() -> Result<Self, String> {
            let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            if hr == S_OK || hr == S_FALSE {
                return Ok(Self {
                    should_uninitialize: true,
                });
            }
            if hr == RPC_E_CHANGED_MODE {
                return Ok(Self {
                    should_uninitialize: false,
                });
            }
            Err(format!("Failed to initialize COM: {hr:?}"))
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.should_uninitialize {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    fn endpoint_volume() -> Result<IAudioEndpointVolume, String> {
        let device_enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|err| format!("Failed to create audio device enumerator: {err}"))?;

        let device = unsafe { device_enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
            .map_err(|err| format!("Failed to get default audio output device: {err}"))?;

        unsafe { device.Activate(CLSCTX_ALL, None) }
            .map_err(|err| format!("Failed to activate endpoint volume: {err}"))
    }

    pub fn capture_state() -> Result<SystemMuteState, String> {
        let _com = ComGuard::initialize()?;
        let endpoint = endpoint_volume()?;
        let was_muted = unsafe { endpoint.GetMute() }
            .map_err(|err| format!("Failed to read output mute state: {err}"))?
            .as_bool();
        let volume = unsafe { endpoint.GetMasterVolumeLevelScalar() }
            .map_err(|err| format!("Failed to read output volume: {err}"))?;

        Ok(SystemMuteState {
            backend: "windows-core-audio".to_string(),
            was_muted,
            volume: Some(volume),
        })
    }

    pub fn mute_system_audio() -> Result<(), String> {
        let _com = ComGuard::initialize()?;
        let endpoint = endpoint_volume()?;
        unsafe { endpoint.SetMute(true, null()) }
            .map_err(|err| format!("Failed to mute system output: {err}"))
    }

    pub fn restore_system_audio(state: &SystemMuteState) -> Result<(), String> {
        let _com = ComGuard::initialize()?;
        let endpoint = endpoint_volume()?;

        if let Some(volume) = state.volume {
            unsafe { endpoint.SetMasterVolumeLevelScalar(volume.clamp(0.0, 1.0), null()) }
                .map_err(|err| format!("Failed to restore output volume: {err}"))?;
        }

        unsafe { endpoint.SetMute(state.was_muted, null()) }
            .map_err(|err| format!("Failed to restore output mute state: {err}"))
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::process::Command;

    use super::SystemMuteState;

    fn osascript(script: &str) -> Result<String, String> {
        let output = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|err| format!("Failed to run osascript: {err}"))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub fn capture_state() -> Result<SystemMuteState, String> {
        let was_muted = osascript("output muted of (get volume settings)")?
            .trim()
            .eq_ignore_ascii_case("true");
        let volume = osascript("output volume of (get volume settings)")?
            .trim()
            .parse::<f32>()
            .ok();

        Ok(SystemMuteState {
            backend: "macos-osascript".to_string(),
            was_muted,
            volume,
        })
    }

    pub fn mute_system_audio() -> Result<(), String> {
        osascript("set volume output muted true").map(|_| ())
    }

    pub fn restore_system_audio(state: &SystemMuteState) -> Result<(), String> {
        if let Some(volume) = state.volume {
            let script = format!(
                "set volume output volume {}",
                volume.clamp(0.0, 100.0).round()
            );
            osascript(&script)?;
        }

        let mute = if state.was_muted { "true" } else { "false" };
        osascript(&format!("set volume output muted {mute}")).map(|_| ())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::process::Command;

    use super::SystemMuteState;

    fn run(command: &str, args: &[&str]) -> Result<String, String> {
        let output = Command::new(command)
            .args(args)
            .output()
            .map_err(|err| format!("Failed to run {command}: {err}"))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn capture_wpctl() -> Result<SystemMuteState, String> {
        let output = run("wpctl", &["get-volume", "@DEFAULT_AUDIO_SINK@"])?;
        let was_muted = output.contains("[MUTED]");
        let volume = output
            .split_whitespace()
            .find_map(|part| part.parse::<f32>().ok());

        Ok(SystemMuteState {
            backend: "linux-wpctl".to_string(),
            was_muted,
            volume,
        })
    }

    fn capture_pactl() -> Result<SystemMuteState, String> {
        let mute_output = run("pactl", &["get-sink-mute", "@DEFAULT_SINK@"])?;
        let volume_output = run("pactl", &["get-sink-volume", "@DEFAULT_SINK@"])?;

        let was_muted = mute_output.to_ascii_lowercase().contains("yes");
        let volume = volume_output
            .split_whitespace()
            .find_map(|part| part.strip_suffix('%')?.parse::<f32>().ok())
            .map(|percent| percent / 100.0);

        Ok(SystemMuteState {
            backend: "linux-pactl".to_string(),
            was_muted,
            volume,
        })
    }

    pub fn capture_state() -> Result<SystemMuteState, String> {
        capture_wpctl().or_else(|_| capture_pactl())
    }

    pub fn mute_system_audio() -> Result<(), String> {
        run("wpctl", &["set-mute", "@DEFAULT_AUDIO_SINK@", "1"])
            .or_else(|_| run("pactl", &["set-sink-mute", "@DEFAULT_SINK@", "1"]))
            .map(|_| ())
    }

    pub fn restore_system_audio(state: &SystemMuteState) -> Result<(), String> {
        match state.backend.as_str() {
            "linux-wpctl" => {
                if let Some(volume) = state.volume {
                    let value = volume.clamp(0.0, 1.5).to_string();
                    run("wpctl", &["set-volume", "@DEFAULT_AUDIO_SINK@", &value])?;
                }
                run(
                    "wpctl",
                    &[
                        "set-mute",
                        "@DEFAULT_AUDIO_SINK@",
                        if state.was_muted { "1" } else { "0" },
                    ],
                )
                .map(|_| ())
            }
            "linux-pactl" => {
                if let Some(volume) = state.volume {
                    let value = format!("{}%", (volume.clamp(0.0, 1.5) * 100.0).round());
                    run("pactl", &["set-sink-volume", "@DEFAULT_SINK@", &value])?;
                }
                run(
                    "pactl",
                    &[
                        "set-sink-mute",
                        "@DEFAULT_SINK@",
                        if state.was_muted { "1" } else { "0" },
                    ],
                )
                .map(|_| ())
            }
            other => Err(format!(
                "Unsupported Linux audio backend in mute guard: {other}"
            )),
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod platform {
    use super::SystemMuteState;

    pub fn capture_state() -> Result<SystemMuteState, String> {
        Ok(SystemMuteState {
            backend: "unsupported".to_string(),
            was_muted: false,
            volume: None,
        })
    }

    pub fn mute_system_audio() -> Result<(), String> {
        Ok(())
    }

    pub fn restore_system_audio(_state: &SystemMuteState) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn start_audio_ducking(app: AppHandle) -> Result<(), String> {
    start_system_mute(&app)
}

#[tauri::command]
pub fn stop_audio_ducking(app: AppHandle) -> Result<(), String> {
    stop_system_mute(&app)
}
