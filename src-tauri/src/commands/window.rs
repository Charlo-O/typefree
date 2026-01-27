use tauri::PhysicalPosition;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Window};

fn move_window_to_bottom_right(window: &Window) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return Ok(());
    };

    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();

    // Prefer outer_size, fall back to inner_size.
    let window_size = window
        .outer_size()
        .or_else(|_| window.inner_size())
        .map_err(|e| e.to_string())?;

    let margin_x: i32 = 24;
    let margin_y: i32 = if cfg!(target_os = "windows") { 72 } else { 24 };

    let x = monitor_pos.x + monitor_size.width as i32 - window_size.width as i32 - margin_x;
    let y = monitor_pos.y + monitor_size.height as i32 - window_size.height as i32 - margin_y;

    window
        .set_position(PhysicalPosition::new(
            x.max(monitor_pos.x),
            y.max(monitor_pos.y),
        ))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Show the dictation panel window
#[tauri::command]
pub fn show_dictation_panel(window: Window) -> Result<(), String> {
    // Ensure it appears at bottom-right when shown.
    // Do this before focus so the final position is stable.
    let _ = move_window_to_bottom_right(&window);
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

/// Show the current window
#[tauri::command]
pub fn show_window(window: Window) -> Result<(), String> {
    // Ensure it appears at bottom-right when shown.
    let _ = move_window_to_bottom_right(&window);
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
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
