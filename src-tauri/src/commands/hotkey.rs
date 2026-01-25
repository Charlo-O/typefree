use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Register a global hotkey for dictation toggle
#[tauri::command]
pub async fn register_hotkey(app: AppHandle, hotkey: String) -> Result<bool, String> {
    // Parse the hotkey string (e.g., "Ctrl+Shift+Space" or "F8")
    let (modifiers, key_code) = parse_hotkey(&hotkey)?;

    // Remove existing shortcuts first
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();

    // Create the shortcut
    let shortcut = if modifiers.is_empty() {
        Shortcut::new(None, key_code)
    } else {
        Shortcut::new(Some(modifiers), key_code)
    };

    // Clone app handle for the callback
    let app_handle = app.clone();

    // Register the shortcut
    manager
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                // Emit toggle-dictation event to the frontend
                let _ = app_handle.emit("toggle-dictation", ());
            }
        })
        .map_err(|e| format!("Failed to register hotkey: {}", e))?;

    Ok(true)
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
