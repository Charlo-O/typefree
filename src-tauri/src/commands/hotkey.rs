use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::AppHandle;
#[cfg(not(target_os = "macos"))]
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const DOUBLE_PRESS_WINDOW: Duration = Duration::from_millis(320);

static HOTKEY_REGISTRATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Default)]
struct DictationHotkeyGestureState {
    last_press_at: Mutex<Option<Instant>>,
}

#[derive(Default)]
struct ClipboardHotkeyGestureState {
    last_press_at: Mutex<Option<Instant>>,
}

#[derive(Clone, Copy)]
enum DictationTriggerMode {
    Single,
    Double,
}

#[derive(Clone, Copy)]
enum HotkeyAction {
    Dictation { trigger_mode: DictationTriggerMode },
    Clipboard,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct HotkeyRegistrationStatus {
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct HotkeyRegistrationResult {
    pub dictation: HotkeyRegistrationStatus,
    pub clipboard: HotkeyRegistrationStatus,
}

fn ok_status(message: impl Into<Option<String>>) -> HotkeyRegistrationStatus {
    HotkeyRegistrationStatus {
        success: true,
        message: message.into(),
    }
}

fn error_status(message: impl Into<String>) -> HotkeyRegistrationStatus {
    HotkeyRegistrationStatus {
        success: false,
        message: Some(message.into()),
    }
}

fn get_setting_string(app: &AppHandle, key: &str) -> Option<String> {
    super::settings::get_setting(app.clone(), key.to_string())
        .ok()
        .flatten()
        .and_then(|value| value.as_str().map(|value| value.to_string()))
}

fn is_push_to_talk(app: &AppHandle) -> bool {
    get_setting_string(app, "activationMode")
        .map(|mode| mode.trim().eq_ignore_ascii_case("push"))
        .unwrap_or(false)
}

fn ensure_dictation_hotkey_gesture_state(app: &AppHandle) {
    if app.try_state::<DictationHotkeyGestureState>().is_none() {
        app.manage(DictationHotkeyGestureState::default());
    }
}

fn ensure_clipboard_hotkey_gesture_state(app: &AppHandle) {
    if app.try_state::<ClipboardHotkeyGestureState>().is_none() {
        app.manage(ClipboardHotkeyGestureState::default());
    }
}

fn dispatch_dictation_hotkey_event(
    app_handle: AppHandle,
    hotkey_label: String,
    is_pressed: bool,
    force_tap_mode: bool,
) {
    #[cfg(target_os = "macos")]
    {
        // On macOS, run hotkey dictation in the backend so it keeps working even if
        // the renderer/webview is throttled while another app is fullscreen.
        super::dictation::handle_hotkey_event(
            app_handle,
            hotkey_label,
            is_pressed,
            force_tap_mode.then_some(false),
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = hotkey_label;
        let push_to_talk = is_push_to_talk(&app_handle) && !force_tap_mode;

        if push_to_talk {
            if is_pressed {
                let _ = super::window::reveal_main_window(&app_handle);
                let _ = app_handle.emit("start-dictation", ());
            } else {
                let _ = app_handle.emit("stop-dictation", ());
            }
        } else if is_pressed {
            // Bring the floating window in front before toggling recording.
            let _ = super::window::reveal_main_window(&app_handle);
            let _ = app_handle.emit("toggle-dictation", ());
        }
    }
}

fn handle_dictation_hotkey_event(
    app_handle: AppHandle,
    hotkey_label: String,
    trigger_mode: DictationTriggerMode,
    is_pressed: bool,
) {
    match trigger_mode {
        DictationTriggerMode::Single => {
            dispatch_dictation_hotkey_event(app_handle, hotkey_label, is_pressed, false)
        }
        DictationTriggerMode::Double => {
            if !is_pressed {
                return;
            }

            ensure_dictation_hotkey_gesture_state(&app_handle);
            let state = app_handle.state::<DictationHotkeyGestureState>();
            let now = Instant::now();

            let is_double_press = {
                let mut last_press_at = state.last_press_at.lock().unwrap();
                match *last_press_at {
                    Some(previous) if now.duration_since(previous) <= DOUBLE_PRESS_WINDOW => {
                        *last_press_at = None;
                        true
                    }
                    _ => {
                        *last_press_at = Some(now);
                        false
                    }
                }
            };

            if is_double_press {
                dispatch_dictation_hotkey_event(app_handle, hotkey_label, true, true);
            }
        }
    }
}

fn handle_clipboard_hotkey_event(app_handle: AppHandle, is_pressed: bool) {
    if !is_pressed {
        return;
    }

    ensure_clipboard_hotkey_gesture_state(&app_handle);
    let state = app_handle.state::<ClipboardHotkeyGestureState>();
    let now = Instant::now();

    let is_double_press = {
        let mut last_press_at = state.last_press_at.lock().unwrap();
        match *last_press_at {
            Some(previous) if now.duration_since(previous) <= DOUBLE_PRESS_WINDOW => {
                *last_press_at = None;
                true
            }
            _ => {
                *last_press_at = Some(now);
                false
            }
        }
    };

    if is_double_press {
        let _ = super::window::show_clipboard_panel(&app_handle);
    }
}

fn handle_hotkey_event(
    app_handle: AppHandle,
    hotkey_label: String,
    action: HotkeyAction,
    is_pressed: bool,
) {
    match action {
        HotkeyAction::Dictation { trigger_mode } => {
            handle_dictation_hotkey_event(app_handle, hotkey_label, trigger_mode, is_pressed)
        }
        HotkeyAction::Clipboard => handle_clipboard_hotkey_event(app_handle, is_pressed),
    }
}

fn is_function_key(key_code: Code) -> bool {
    matches!(
        key_code,
        Code::F1
            | Code::F2
            | Code::F3
            | Code::F4
            | Code::F5
            | Code::F6
            | Code::F7
            | Code::F8
            | Code::F9
            | Code::F10
            | Code::F11
            | Code::F12
    )
}

fn validate_hotkey(
    action: HotkeyAction,
    modifiers: Modifiers,
    key_code: Code,
) -> Result<(), String> {
    match action {
        HotkeyAction::Dictation { .. } => {
            let has_non_shift_modifier = modifiers.contains(Modifiers::CONTROL)
                || modifiers.contains(Modifiers::ALT)
                || modifiers.contains(Modifiers::META);
            let is_shift_only = modifiers == Modifiers::SHIFT;

            if !is_function_key(key_code) && (!has_non_shift_modifier || is_shift_only) {
                return Err(
                    "Hotkey must include Command/Ctrl/Alt (or use F1-F12). Example: CommandOrControl+Shift+Space".to_string(),
                );
            }

            Ok(())
        }
        HotkeyAction::Clipboard => {
            let _ = key_code;
            if !modifiers.is_empty() {
                return Err(
                    "Clipboard double key must be a single key. Do not use Ctrl/Alt/Shift/Command."
                        .to_string(),
                );
            }

            Ok(())
        }
    }
}

fn register_shortcut(
    app: &AppHandle,
    hotkey: &str,
    action: HotkeyAction,
) -> HotkeyRegistrationStatus {
    let (modifiers, key_code) = match parse_hotkey(hotkey) {
        Ok(parsed) => parsed,
        Err(err) => return error_status(err),
    };

    if let Err(err) = validate_hotkey(action, modifiers, key_code) {
        return error_status(err);
    }

    let shortcut = if modifiers.is_empty() {
        Shortcut::new(None, key_code)
    } else {
        Shortcut::new(Some(modifiers), key_code)
    };

    let app_handle = app.clone();
    let hotkey_label = hotkey.to_string();
    let manager = app.global_shortcut();

    match manager.on_shortcut(shortcut, move |_app, _shortcut, event| {
        let is_pressed = event.state == ShortcutState::Pressed;

        let hotkey_label = hotkey_label.clone();
        let app_for_callback = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            if is_pressed {
                eprintln!("[hotkey] pressed: {}", hotkey_label);
            } else {
                eprintln!("[hotkey] released: {}", hotkey_label);
            }
            handle_hotkey_event(app_for_callback, hotkey_label, action, is_pressed);
        });
    }) {
        Ok(_) => ok_status(None),
        Err(err) => error_status(format!("Failed to register hotkey: {}", err)),
    }
}

fn normalize_hotkey(hotkey: Option<String>) -> Option<String> {
    hotkey.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn parse_dictation_trigger_mode(mode: Option<String>) -> DictationTriggerMode {
    match mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) if value.eq_ignore_ascii_case("double") => DictationTriggerMode::Double,
        _ => DictationTriggerMode::Single,
    }
}

fn register_hotkeys_impl(
    app: &AppHandle,
    dictation_hotkey: Option<String>,
    clipboard_hotkey: Option<String>,
    dictation_trigger_mode: Option<String>,
) -> HotkeyRegistrationResult {
    let _registration_guard = HOTKEY_REGISTRATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let dictation_hotkey = normalize_hotkey(dictation_hotkey);
    let clipboard_hotkey = normalize_hotkey(clipboard_hotkey);
    let dictation_trigger_mode = parse_dictation_trigger_mode(dictation_trigger_mode);

    let manager = app.global_shortcut();
    let _ = manager.unregister_all();

    let dictation = match dictation_hotkey.as_deref() {
        Some(hotkey) => register_shortcut(
            app,
            hotkey,
            HotkeyAction::Dictation {
                trigger_mode: dictation_trigger_mode,
            },
        ),
        None => ok_status(None),
    };

    let clipboard = match clipboard_hotkey.as_deref() {
        Some(hotkey)
            if dictation_hotkey
                .as_deref()
                .map(|dictation| dictation.eq_ignore_ascii_case(hotkey))
                .unwrap_or(false) =>
        {
            error_status("Clipboard hotkey must be different from dictation hotkey.")
        }
        Some(hotkey) => register_shortcut(app, hotkey, HotkeyAction::Clipboard),
        None => ok_status(None),
    };

    HotkeyRegistrationResult {
        dictation,
        clipboard,
    }
}

/// Register a global hotkey for dictation toggle
#[tauri::command]
pub async fn register_hotkey(app: AppHandle, hotkey: String) -> Result<bool, String> {
    let result = register_hotkeys_impl(&app, Some(hotkey), None, None);
    Ok(result.dictation.success)
}

/// Register the dictation and clipboard hotkeys together.
#[tauri::command]
pub async fn register_hotkeys(
    app: AppHandle,
    dictation_hotkey: Option<String>,
    clipboard_hotkey: Option<String>,
    dictation_trigger_mode: Option<String>,
) -> Result<HotkeyRegistrationResult, String> {
    Ok(register_hotkeys_impl(
        &app,
        dictation_hotkey,
        clipboard_hotkey,
        dictation_trigger_mode,
    ))
}

/// Unregister all global hotkeys
#[tauri::command]
pub async fn unregister_hotkeys(app: AppHandle) -> Result<(), String> {
    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|e| e.to_string())?;
    Ok(())
}

/// Parse hotkey string into modifiers and key code
fn parse_hotkey(hotkey: &str) -> Result<(Modifiers, Code), String> {
    let parts: Vec<&str> = hotkey.split('+').map(|s| s.trim()).collect();

    let mut modifiers = Modifiers::empty();
    let mut key_str = "";

    for part in &parts {
        match part.to_uppercase().as_str() {
            "CTRL" | "CONTROL" => modifiers |= Modifiers::CONTROL,
            "SHIFT" => modifiers |= Modifiers::SHIFT,
            "ALT" | "OPTION" => modifiers |= Modifiers::ALT,
            "META" | "CMD" | "COMMAND" | "WIN" | "SUPER" => modifiers |= Modifiers::META,
            // CommandOrControl is CONTROL on Windows/Linux, META on macOS
            "COMMANDORCONTROL" | "CMDORCTRL" => {
                #[cfg(target_os = "macos")]
                {
                    modifiers |= Modifiers::META;
                }
                #[cfg(not(target_os = "macos"))]
                {
                    modifiers |= Modifiers::CONTROL;
                }
            }
            _ => key_str = *part,
        }
    }

    let key_code = match key_str.to_uppercase().as_str() {
        // Function keys
        "F1" => Code::F1,
        "F2" => Code::F2,
        "F3" => Code::F3,
        "F4" => Code::F4,
        "F5" => Code::F5,
        "F6" => Code::F6,
        "F7" => Code::F7,
        "F8" => Code::F8,
        "F9" => Code::F9,
        "F10" => Code::F10,
        "F11" => Code::F11,
        "F12" => Code::F12,
        // Special keys
        "SPACE" | " " => Code::Space,
        "ENTER" | "RETURN" => Code::Enter,
        "ESCAPE" | "ESC" => Code::Escape,
        "TAB" => Code::Tab,
        "BACKSPACE" => Code::Backspace,
        "DELETE" | "DEL" => Code::Delete,
        "INSERT" | "INS" => Code::Insert,
        "HOME" => Code::Home,
        "END" => Code::End,
        "PAGEUP" | "PGUP" => Code::PageUp,
        "PAGEDOWN" | "PGDN" => Code::PageDown,
        // Arrow keys
        "UP" | "ARROWUP" => Code::ArrowUp,
        "DOWN" | "ARROWDOWN" => Code::ArrowDown,
        "LEFT" | "ARROWLEFT" => Code::ArrowLeft,
        "RIGHT" | "ARROWRIGHT" => Code::ArrowRight,
        // Letter keys
        "A" => Code::KeyA,
        "B" => Code::KeyB,
        "C" => Code::KeyC,
        "D" => Code::KeyD,
        "E" => Code::KeyE,
        "F" => Code::KeyF,
        "G" => Code::KeyG,
        "H" => Code::KeyH,
        "I" => Code::KeyI,
        "J" => Code::KeyJ,
        "K" => Code::KeyK,
        "L" => Code::KeyL,
        "M" => Code::KeyM,
        "N" => Code::KeyN,
        "O" => Code::KeyO,
        "P" => Code::KeyP,
        "Q" => Code::KeyQ,
        "R" => Code::KeyR,
        "S" => Code::KeyS,
        "T" => Code::KeyT,
        "U" => Code::KeyU,
        "V" => Code::KeyV,
        "W" => Code::KeyW,
        "X" => Code::KeyX,
        "Y" => Code::KeyY,
        "Z" => Code::KeyZ,
        // Number keys
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        // Symbols
        "`" | "BACKQUOTE" => Code::Backquote,
        "-" | "MINUS" => Code::Minus,
        "=" | "EQUAL" => Code::Equal,
        "[" | "BRACKETLEFT" => Code::BracketLeft,
        "]" | "BRACKETRIGHT" => Code::BracketRight,
        "\\" | "BACKSLASH" => Code::Backslash,
        ";" | "SEMICOLON" => Code::Semicolon,
        "'" | "QUOTE" => Code::Quote,
        "," | "COMMA" => Code::Comma,
        "." | "PERIOD" => Code::Period,
        "/" | "SLASH" => Code::Slash,
        _ => return Err(format!("Unknown key: {}", key_str)),
    };

    Ok((modifiers, key_code))
}
