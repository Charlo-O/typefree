use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Window};

/// Show the dictation panel window
#[tauri::command]
pub fn show_dictation_panel(window: Window) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Show the control panel window
#[tauri::command]
pub fn show_control_panel(app: AppHandle) -> Result<(), String> {
    // Try to get existing window first
    if let Some(window) = app.get_webview_window("control") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Create new window if it doesn't exist
    let url = WebviewUrl::App("?panel=true".into());
    WebviewWindowBuilder::new(&app, "control", url)
        .title("Typefree - Control Panel")
        .inner_size(800.0, 600.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Hide the current window
#[tauri::command]
pub fn hide_window(window: Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// Start window drag operation
#[tauri::command]
pub fn start_drag(window: Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

/// Get current platform
#[tauri::command]
pub fn get_platform() -> String {
    #[cfg(target_os = "windows")]
    return "win32".to_string();

    #[cfg(target_os = "macos")]
    return "darwin".to_string();

    #[cfg(target_os = "linux")]
    return "linux".to_string();

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return "unknown".to_string();
}
