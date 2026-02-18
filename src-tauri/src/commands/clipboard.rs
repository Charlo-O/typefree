use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose, Engine as _};
use enigo::{Enigo, Key, Keyboard, Settings};
use std::borrow::Cow;
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

#[cfg(target_os = "macos")]
fn ensure_accessibility_permission() -> Result<(), String> {
    // Without Accessibility permission, macOS will ignore synthetic keyboard events, so paste will
    // appear to "do nothing".
    let trusted = unsafe { AXIsProcessTrusted() };
    if trusted {
        Ok(())
    } else {
        Err("macOS Accessibility permission is required for automatic pasting. Enable Typefree in System Settings -> Privacy & Security -> Accessibility, then restart Typefree.".to_string())
    }
}

fn simulate_paste() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        // Use a layout-independent keycode for 'V' (kVK_ANSI_V = 0x09) so Cmd+V works regardless
        // of the current keyboard layout / IME.
        let v_key = Key::Other(0x09);
        enigo
            .key(Key::Meta, enigo::Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo
            .key(v_key, enigo::Direction::Click)
            .map_err(|e| e.to_string())?;
        // Give the target app a moment to observe the modifier + keypress.
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
    // enigo uses HIToolbox/TSM APIs on macOS that must run on the main dispatch queue.
    // Calling it from a tokio worker can trip `dispatch_assert_queue` and crash (SIGTRAP).
    #[cfg(target_os = "macos")]
    {
        ensure_accessibility_permission()?;

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        app.run_on_main_thread(move || {
            // Best-effort: ignore send errors if the receiver is already dropped.
            let _ = tx.send(simulate_paste());
        })
        .map_err(|e| e.to_string())?;

        return rx
            .recv()
            .map_err(|e| format!("Failed to receive paste result: {e}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app; // silence unused warning on non-macOS
        simulate_paste()
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
pub fn paste_text(app: AppHandle, text: String) -> Result<(), String> {
    // Preserve the user's clipboard contents (best-effort). This matches Handy's behavior and
    // prevents dictation from permanently overwriting clipboard history.
    let clipboard = app.clipboard();
    let previous_clipboard_text = clipboard.read_text().ok();
    eprintln!(
        "[clipboard] paste_text len={} prev_clipboard={}",
        text.len(),
        previous_clipboard_text.is_some()
    );

    // First write to clipboard
    clipboard
        .write_text(text.clone())
        .map_err(|e| format!("Failed to write to clipboard: {e}"))?;

    // Small delay before paste
    thread::sleep(Duration::from_millis(80));

    // If paste fails, we intentionally keep the transcription in the clipboard so the user can
    // paste manually.
    if let Err(err) = simulate_paste_best_effort(&app) {
        eprintln!("[clipboard] simulate_paste failed: {}", err);
        return Err(format!(
            "{err}. Text is copied to clipboard; paste manually with Cmd+V."
        ));
    }

    // Allow the target app to read from the clipboard before we restore it.
    thread::sleep(Duration::from_millis(150));
    if let Some(previous) = previous_clipboard_text {
        let _ = clipboard.write_text(previous);
    }

    eprintln!("[clipboard] paste_text done");
    Ok(())
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
pub fn paste_image(app: AppHandle, data_url: String) -> Result<(), String> {
    write_clipboard_image(data_url)?;
    thread::sleep(Duration::from_millis(50));
    simulate_paste_best_effort(&app)
}
