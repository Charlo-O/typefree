use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose, Engine as _};
use enigo::{Enigo, Key, Keyboard, Settings};
use serde::Serialize;
use std::borrow::Cow;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::process::Command;
#[cfg(target_os = "macos")]
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

const PASTE_PRE_DELAY_MS: u64 = 140;
const PASTE_RESTORE_DELAY_MS: u64 = 260;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteToolsResult {
    pub platform: String,
    pub available: bool,
    pub method: Option<String>,
    pub requires_permission: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_wayland: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xwayland_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended_install: Option<String>,
}

#[cfg(target_os = "macos")]
fn ensure_accessibility_permission() -> Result<(), String> {
    let trusted = unsafe { AXIsProcessTrusted() };
    if trusted {
        Ok(())
    } else {
        Err("macOS Accessibility permission is required for automatic pasting. Enable Typefree in System Settings -> Privacy & Security -> Accessibility, then restart Typefree.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn open_accessibility_settings_best_effort() {
    let attempts: [&[&str]; 2] = [
        &[
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        ],
        &["-b", "com.apple.systempreferences"],
    ];

    for args in attempts {
        if let Ok(status) = Command::new("open").args(args).status() {
            if status.success() {
                return;
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn simulate_paste_with_applescript() -> Result<(), String> {
    let output = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to key code 9 using command down",
        ])
        .output()
        .map_err(|e| format!("Failed to launch osascript: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "unknown AppleScript error".to_string()
        };
        Err(format!("AppleScript paste failed: {detail}"))
    }
}

fn simulate_paste_with_enigo() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let v_key = Key::Other(0x09);
        enigo
            .key(Key::Meta, enigo::Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo
            .key(v_key, enigo::Direction::Click)
            .map_err(|e| e.to_string())?;
        thread::sleep(Duration::from_millis(100));
        enigo
            .key(Key::Meta, enigo::Direction::Release)
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        enigo
            .key(Key::Control, enigo::Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Unicode('v'), enigo::Direction::Click)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Control, enigo::Direction::Release)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn simulate_paste_best_effort(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        ensure_accessibility_permission()?;

        if let Err(err) = simulate_paste_with_applescript() {
            eprintln!("[clipboard] AppleScript paste failed, falling back to Enigo: {err}");
        } else {
            return Ok(());
        }

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        app.run_on_main_thread(move || {
            let _ = tx.send(simulate_paste_with_enigo());
        })
        .map_err(|e| e.to_string())?;

        return rx
            .recv()
            .map_err(|e| format!("Failed to receive paste result: {e}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        simulate_paste_with_enigo()
    }
}

#[cfg(not(target_os = "macos"))]
fn insert_text_direct(text: &str) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.text(text).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn command_exists(command: &str) -> bool {
    Command::new("sh")
        .args(["-lc", &format!("command -v {command} >/dev/null 2>&1")])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn check_paste_tools() -> PasteToolsResult {
    #[cfg(target_os = "macos")]
    {
        return PasteToolsResult {
            platform: "darwin".to_string(),
            available: true,
            method: Some("applescript".to_string()),
            requires_permission: true,
            is_wayland: None,
            xwayland_available: None,
            tools: None,
            recommended_install: None,
        };
    }

    #[cfg(target_os = "windows")]
    {
        return PasteToolsResult {
            platform: "win32".to_string(),
            available: true,
            method: Some("text-entry".to_string()),
            requires_permission: false,
            is_wayland: None,
            xwayland_available: None,
            tools: None,
            recommended_install: None,
        };
    }

    #[cfg(target_os = "linux")]
    {
        let xdotool = command_exists("xdotool");
        let wtype = command_exists("wtype");
        let ydotool = command_exists("ydotool");
        let is_wayland = std::env::var("WAYLAND_DISPLAY")
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        let available = xdotool || wtype || ydotool;
        let method = if wtype {
            Some("wtype".to_string())
        } else if ydotool {
            Some("ydotool".to_string())
        } else if xdotool {
            Some("xdotool".to_string())
        } else {
            None
        };

        return PasteToolsResult {
            platform: "linux".to_string(),
            available,
            method,
            requires_permission: false,
            is_wayland: Some(is_wayland),
            xwayland_available: Some(xdotool),
            tools: Some(
                [
                    ("xdotool", xdotool),
                    ("wtype", wtype),
                    ("ydotool", ydotool),
                ]
                .into_iter()
                .filter_map(|(name, present)| present.then(|| name.to_string()))
                .collect(),
            ),
            recommended_install: if available {
                None
            } else if is_wayland {
                Some("wtype".to_string())
            } else {
                Some("xdotool".to_string())
            },
        };
    }
}

#[tauri::command]
pub fn check_accessibility_permission(prompt: Option<bool>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let granted = unsafe { AXIsProcessTrusted() };
        if !granted && prompt.unwrap_or(false) {
            open_accessibility_settings_best_effort();
        }
        return Ok(granted);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = prompt;
        Ok(true)
    }
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let trimmed = data_url.trim();
    let payload = match trimmed.find(',') {
        Some(idx) => &trimmed[idx + 1..],
        None => trimmed,
    };
    general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Failed to decode base64: {e}"))
}

#[tauri::command]
pub fn write_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn read_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn paste_text(app: AppHandle, text: String) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        if text.trim().is_empty() {
            return Ok(());
        }

        if let Err(err) = insert_text_direct(&text) {
            let clipboard = app.clipboard();
            let _ = clipboard.write_text(text.clone());
            eprintln!("[clipboard] direct text entry failed: {}", err);
            return Err(format!(
                "Direct text entry failed: {err}. Text is copied to clipboard; paste manually with Ctrl+V."
            ));
        }

        eprintln!("[clipboard] direct text entry done");
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
    let clipboard = app.clipboard();
    let previous_clipboard_text = clipboard.read_text().ok();
    eprintln!(
        "[clipboard] paste_text len={} prev_clipboard={}",
        text.len(),
        previous_clipboard_text.is_some()
    );

    clipboard
        .write_text(text.clone())
        .map_err(|e| format!("Failed to write to clipboard: {e}"))?;

    thread::sleep(Duration::from_millis(PASTE_PRE_DELAY_MS));

    if let Err(err) = simulate_paste_best_effort(&app) {
        #[cfg(target_os = "macos")]
        if err.contains("Accessibility permission") {
            open_accessibility_settings_best_effort();
        }

        eprintln!("[clipboard] simulate_paste failed: {}", err);
        return Err(format!(
            "{err}. Text is copied to clipboard; paste manually with Cmd+V."
        ));
    }

    thread::sleep(Duration::from_millis(PASTE_RESTORE_DELAY_MS));
    if let Some(previous) = previous_clipboard_text {
        let _ = clipboard.write_text(previous);
    }

    eprintln!("[clipboard] paste_text done");
    Ok(())
    }
}

#[tauri::command]
pub fn write_clipboard_image(data_url: String) -> Result<(), String> {
    let png_bytes = decode_data_url(&data_url)?;
    let dyn_img =
        image::load_from_memory(&png_bytes).map_err(|e| format!("Failed to decode image: {e}"))?;
    let rgba = dyn_img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let raw = rgba.into_raw();

    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(raw),
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn paste_image(app: AppHandle, data_url: String) -> Result<(), String> {
    write_clipboard_image(data_url)?;
    thread::sleep(Duration::from_millis(50));
    simulate_paste_best_effort(&app)
}
