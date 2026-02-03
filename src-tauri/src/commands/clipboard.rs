use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose, Engine as _};
use enigo::{Enigo, Key, Keyboard, Settings};
use std::borrow::Cow;
use std::thread;
use std::time::Duration;

fn simulate_paste() -> Result<(), String> {
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

    simulate_paste()
}

/// Write an image (data URL: data:image/png;base64,...) to clipboard
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

/// Paste image by writing to clipboard and simulating Ctrl+V
#[tauri::command]
pub fn paste_image(data_url: String) -> Result<(), String> {
    write_clipboard_image(data_url)?;
    thread::sleep(Duration::from_millis(50));
    simulate_paste()
}
