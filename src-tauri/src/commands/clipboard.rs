use arboard::Clipboard;
use enigo::{Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

/// Write text to clipboard
#[tauri::command]
pub fn write_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

/// Read text from clipboard
#[tauri::command]
pub fn read_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

/// Paste text by writing to clipboard and simulating Ctrl+V
#[tauri::command]
pub fn paste_text(text: String) -> Result<(), String> {
    // First write to clipboard
    write_clipboard(text.clone())?;

    // Small delay before paste
    thread::sleep(Duration::from_millis(50));

    // Simulate Ctrl+V paste
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        enigo
            .key(Key::Meta, enigo::Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Unicode('v'), enigo::Direction::Click)
            .map_err(|e| e.to_string())?;
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
