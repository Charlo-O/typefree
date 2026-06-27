use serde::Serialize;
use std::path::Path;
use std::process::Command;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window,
};

use super::command_error::{CommandError, CommandResult};

const MAIN_WINDOW_WIDTH: f64 = 240.0;
const MAIN_WINDOW_HEIGHT: f64 = 140.0;
const MAIN_WINDOW_CENTER_Y_RATIO: f64 = 0.84;
const CONTROL_PANEL_WIDTH: f64 = 1040.0;
const CONTROL_PANEL_HEIGHT: f64 = 760.0;
const CLIPBOARD_PANEL_WIDTH: f64 = 920.0;
const CLIPBOARD_PANEL_HEIGHT: f64 = 720.0;

fn window_error(message: impl Into<String>) -> CommandError {
    CommandError::from_message(message.into()).with_source("window")
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundApplication {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub process_id: Option<u32>,
    pub bundle_id: Option<String>,
    pub executable_path: Option<String>,
}

fn clean_app_field(value: impl AsRef<str>) -> String {
    value.as_ref().trim().trim_matches('"').to_string()
}

fn normalize_app_key(value: &str) -> String {
    clean_app_field(value)
        .to_lowercase()
        .replace('\\', "/")
        .split('/')
        .last()
        .unwrap_or(value)
        .trim_end_matches(".exe")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn filename_stem(path: &str) -> Option<String> {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(clean_app_field)
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "macos")]
fn log_webview_state(stage: &str, window: &WebviewWindow) {
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    let pos = window.outer_position().ok();
    let size = window.outer_size().ok();

    eprintln!(
        "[window] {} visible={} minimized={} focused={} pos={:?} size={:?}",
        stage, visible, minimized, focused, pos, size
    );
}

#[cfg(target_os = "macos")]
pub(crate) fn promote_webview_window_for_fullscreen(window: &WebviewWindow) {
    use objc2::exception;
    use objc2_app_kit::{
        NSFloatingWindowLevel, NSPopUpMenuWindowLevel, NSStatusWindowLevel, NSWindow,
        NSWindowCollectionBehavior, NSWindowOcclusionState,
    };
    use std::panic::AssertUnwindSafe;

    // Re-enable native macOS promotion for fullscreen/Spaces, but guard Objective-C exceptions.
    let native_result = window.with_webview(|webview| {
        let try_objc = |stage: &str, f: fn(&NSWindow)| {
            let result = exception::catch(AssertUnwindSafe(|| unsafe {
                let ns_window: &NSWindow = &*webview.ns_window().cast();
                f(ns_window);
            }));
            if let Err(exc) = result {
                eprintln!("[window] objc exception at {}: {:?}", stage, exc);
            }
        };

        let snapshot = |stage: &str| {
            let result = exception::catch(AssertUnwindSafe(|| unsafe {
                let ns_window: &NSWindow = &*webview.ns_window().cast();
                let on_active_space = ns_window.isOnActiveSpace();
                let occlusion = ns_window.occlusionState();
                let visible = occlusion.contains(NSWindowOcclusionState::Visible);
                let level = ns_window.level();
                let behavior = ns_window.collectionBehavior();
                eprintln!(
                    "[window] native_state {} on_active_space={} visible={} level={} behavior={:?} occlusion={:?}",
                    stage, on_active_space, visible, level, behavior, occlusion
                );
            }));
            if let Err(exc) = result {
                eprintln!("[window] objc exception at {} snapshot: {:?}", stage, exc);
            }
        };

        snapshot("before_promote");

        try_objc("setCollectionBehavior", |ns_window: &NSWindow| {
            let mut behavior = ns_window.collectionBehavior();

            // Important: Several collectionBehavior bits are mutually exclusive and will
            // raise an Objective-C exception if you set conflicting combinations.
            // Start by clearing those groups, then insert only what we need.
            behavior.remove(NSWindowCollectionBehavior::ParticipatesInCycle);
            behavior.remove(NSWindowCollectionBehavior::IgnoresCycle);

            behavior.remove(NSWindowCollectionBehavior::FullScreenPrimary);
            behavior.remove(NSWindowCollectionBehavior::FullScreenAuxiliary);
            behavior.remove(NSWindowCollectionBehavior::FullScreenNone);

            behavior.remove(NSWindowCollectionBehavior::FullScreenAllowsTiling);
            behavior.remove(NSWindowCollectionBehavior::FullScreenDisallowsTiling);

            // Minimum required for visibility above other apps' fullscreen Spaces.
            behavior.insert(NSWindowCollectionBehavior::CanJoinAllSpaces);
            behavior.insert(NSWindowCollectionBehavior::MoveToActiveSpace);
            behavior.insert(NSWindowCollectionBehavior::FullScreenAuxiliary);

            ns_window.setCollectionBehavior(behavior);
        });

        try_objc("setHidesOnDeactivate(false)", |ns_window: &NSWindow| {
            ns_window.setHidesOnDeactivate(false);
        });

        // Escalate window level to reliably show above fullscreen apps.
        try_objc("setLevel(NSPopUpMenuWindowLevel)+orderFrontRegardless", |ns_window: &NSWindow| {
            ns_window.setLevel(NSPopUpMenuWindowLevel);
            ns_window.orderFrontRegardless();
        });

        // If still not visible/active, try another level toggle.
        try_objc("level_toggle_fallback", |ns_window: &NSWindow| {
            if !ns_window.isOnActiveSpace()
                || !ns_window
                    .occlusionState()
                    .contains(NSWindowOcclusionState::Visible)
            {
                ns_window.setLevel(NSFloatingWindowLevel);
                ns_window.orderFrontRegardless();
                ns_window.setLevel(NSStatusWindowLevel);
                ns_window.orderFrontRegardless();
                ns_window.setLevel(NSPopUpMenuWindowLevel);
                ns_window.orderFrontRegardless();
            }
        });

        snapshot("after_promote");
    });
    if let Err(err) = native_result {
        eprintln!("[window] with_webview promotion failed: {}", err);
    }
}

fn move_window_to_bottom_right(window: &Window) -> Result<(), String> {
    let cursor = window.app_handle().cursor_position().ok();
    let monitor = {
        let app = window.app_handle();
        let cursor_monitor = cursor
            .as_ref()
            .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten());

        cursor_monitor
            .or_else(|| window.current_monitor().ok().flatten())
            .or_else(|| window.primary_monitor().ok().flatten())
    };

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

    #[cfg(target_os = "macos")]
    eprintln!(
        "[window] move(window) cursor={:?} monitor_pos=({}, {}) monitor_size=({}, {}) target=({}, {})",
        cursor,
        monitor_pos.x,
        monitor_pos.y,
        monitor_size.width,
        monitor_size.height,
        x,
        y
    );

    window
        .set_position(PhysicalPosition::new(
            x.max(monitor_pos.x),
            y.max(monitor_pos.y),
        ))
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn resize_main_webview_window(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_size(Size::Logical(LogicalSize {
            width: MAIN_WINDOW_WIDTH,
            height: MAIN_WINDOW_HEIGHT,
        }))
        .map_err(|e| e.to_string())
}

fn move_main_webview_to_lower_center(window: &WebviewWindow) -> Result<(), String> {
    let cursor = window.app_handle().cursor_position().ok();
    let monitor = {
        let app = window.app_handle();
        let cursor_monitor = cursor
            .as_ref()
            .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten());

        cursor_monitor
            .or_else(|| window.current_monitor().ok().flatten())
            .or_else(|| window.primary_monitor().ok().flatten())
    };

    let Some(monitor) = monitor else {
        return Ok(());
    };

    let work_area = monitor.work_area();

    let window_size = window
        .outer_size()
        .or_else(|_| window.inner_size())
        .map_err(|e| e.to_string())?;

    let max_x = work_area.position.x + work_area.size.width as i32 - window_size.width as i32;
    let max_y = work_area.position.y + work_area.size.height as i32 - window_size.height as i32;
    let centered_x =
        work_area.position.x + ((work_area.size.width as i32 - window_size.width as i32) / 2);
    let target_center_y =
        work_area.position.y as f64 + (work_area.size.height as f64 * MAIN_WINDOW_CENTER_Y_RATIO);
    let centered_y = target_center_y.round() as i32 - (window_size.height as i32 / 2);

    window
        .set_position(PhysicalPosition::new(
            centered_x.clamp(work_area.position.x, max_x.max(work_area.position.x)),
            centered_y.clamp(work_area.position.y, max_y.max(work_area.position.y)),
        ))
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub(crate) fn reveal_window(window: &Window) -> Result<(), String> {
    if window.label() == "main" {
        return reveal_main_window(&window.app_handle());
    }

    // Position first so macOS animation/focus lands at the final location.
    let _ = move_window_to_bottom_right(window);

    // If the user minimized the window, make sure it can be shown again.
    let _ = window.unminimize();

    #[cfg(target_os = "macos")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.set_always_on_top(true);
    }

    window.show().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        if let Some(main_window) = window.app_handle().get_webview_window("main") {
            let main_window_for_mt = main_window.clone();
            let _ = main_window.run_on_main_thread(move || {
                promote_webview_window_for_fullscreen(&main_window_for_mt);
            });
        }
    }

    // Keep best-effort focus; macOS can deny focus in some transitions.
    let _ = window.set_focus();
    Ok(())
}

pub(crate) fn reveal_main_window(app: &AppHandle) -> Result<(), String> {
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    // macOS window operations are more reliable on the main thread, especially across
    // fullscreen/Spaces transitions.
    let main_window_for_mt = main_window.clone();
    main_window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            log_webview_state("before_reveal", &main_window_for_mt);

            let _ = main_window_for_mt.unminimize();
            let _ = resize_main_webview_window(&main_window_for_mt);
            let _ = move_main_webview_to_lower_center(&main_window_for_mt);

            #[cfg(target_os = "macos")]
            {
                let _ = main_window_for_mt.set_visible_on_all_workspaces(true);
                let _ = main_window_for_mt.set_always_on_top(true);
            }

            let _ = main_window_for_mt.show();

            #[cfg(target_os = "macos")]
            {
                // Re-position after showing so we use the final, DPI-scaled outer size.
                let _ = move_main_webview_to_lower_center(&main_window_for_mt);

                // Important: perform native promotion after `always_on_top` so Tauri doesn't
                // override the NSWindow level we set.
                promote_webview_window_for_fullscreen(&main_window_for_mt);
            }

            #[cfg(target_os = "macos")]
            log_webview_state("after_reveal", &main_window_for_mt);
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Show the dictation panel window
#[tauri::command]
pub fn show_dictation_panel(window: Window) -> CommandResult<()> {
    reveal_window(&window).map_err(window_error)
}

/// Show the control panel window
#[tauri::command]
pub fn show_control_panel(app: AppHandle) -> CommandResult<()> {
    show_control_panel_window(&app).map_err(window_error)
}

pub(crate) fn show_clipboard_panel(app: &AppHandle) -> Result<(), String> {
    show_clipboard_window(app)
}

fn show_control_panel_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("control") {
        let _ = window.unminimize();
        let _ = window.set_title("Typefree - Control Panel");
        let _ = window.set_size(Size::Logical(LogicalSize {
            width: CONTROL_PANEL_WIDTH,
            height: CONTROL_PANEL_HEIGHT,
        }));
        let _ = window.emit("open-control-panel", ());
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, "control", WebviewUrl::App("?panel=true".into()))
        .title("Typefree - Control Panel")
        .inner_size(CONTROL_PANEL_WIDTH, CONTROL_PANEL_HEIGHT)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    let _ = window.emit("open-control-panel", ());
    let _ = window.set_focus();

    Ok(())
}

fn show_clipboard_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("clipboard") {
        let _ = window.unminimize();
        let _ = window.set_title("Typefree - Clipboard");
        let _ = window.set_size(Size::Logical(LogicalSize {
            width: CLIPBOARD_PANEL_WIDTH,
            height: CLIPBOARD_PANEL_HEIGHT,
        }));
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        "clipboard",
        WebviewUrl::App("?panel=true&section=clipboard&clipboardOnly=1".into()),
    )
    .title("Typefree - Clipboard")
    .inner_size(CLIPBOARD_PANEL_WIDTH, CLIPBOARD_PANEL_HEIGHT)
    .center()
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Hide the current window
#[tauri::command]
pub fn hide_window(window: Window) -> CommandResult<()> {
    window.hide().map_err(|e| window_error(e.to_string()))
}

/// Quit the application instead of hiding a window to the system tray.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Show the current window
#[tauri::command]
pub fn show_window(window: Window) -> CommandResult<()> {
    reveal_window(&window).map_err(window_error)
}

/// Start window drag operation
#[tauri::command]
pub fn start_drag(window: Window) -> CommandResult<()> {
    window
        .start_dragging()
        .map_err(|e| window_error(e.to_string()))
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

#[cfg(target_os = "macos")]
fn detect_foreground_application_impl() -> Result<Option<ForegroundApplication>, String> {
    let script = r#"
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set appBundle to bundle identifier of frontApp
end tell
return appName & "\t" & appBundle
"#;
    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| format!("Failed to run osascript for foreground app: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Failed to detect foreground application on macOS.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let mut parts = stdout.split('\t');
    let name = clean_app_field(parts.next().unwrap_or_default());
    let bundle_id = clean_app_field(parts.next().unwrap_or_default());
    let id = normalize_app_key(if bundle_id.is_empty() {
        &name
    } else {
        &bundle_id
    });

    if id.is_empty() {
        return Ok(None);
    }

    Ok(Some(ForegroundApplication {
        id,
        name,
        platform: get_platform(),
        process_id: None,
        bundle_id: if bundle_id.is_empty() {
            None
        } else {
            Some(bundle_id)
        },
        executable_path: None,
    }))
}

#[cfg(target_os = "windows")]
fn detect_foreground_application_impl() -> Result<Option<ForegroundApplication>, String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return Ok(None);
    }

    let mut process_id = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    }
    if process_id == 0 {
        return Ok(None);
    }

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
        .map_err(|e| format!("Failed to open foreground process: {e}"))?;
    let mut buffer = vec![0u16; 32768];
    let mut size = buffer.len() as u32;
    let query_result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
    };
    let _ = unsafe { CloseHandle(handle) };

    query_result.map_err(|e| format!("Failed to read foreground process path: {e}"))?;

    let executable_path = String::from_utf16_lossy(&buffer[..size as usize]);
    let name = filename_stem(&executable_path).unwrap_or_else(|| executable_path.clone());
    let id = normalize_app_key(&name);
    if id.is_empty() {
        return Ok(None);
    }

    Ok(Some(ForegroundApplication {
        id,
        name,
        platform: get_platform(),
        process_id: Some(process_id),
        bundle_id: None,
        executable_path: Some(executable_path),
    }))
}

#[cfg(target_os = "linux")]
fn detect_foreground_application_impl() -> Result<Option<ForegroundApplication>, String> {
    let script = r#"
if command -v xdotool >/dev/null 2>&1; then
  pid="$(xdotool getactivewindow getwindowpid 2>/dev/null)"
  name="$(ps -p "$pid" -o comm= 2>/dev/null | head -n 1 | tr -d '\n')"
  exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null)"
  printf '%s\t%s\t%s' "$name" "$pid" "$exe"
else
  exit 2
fi
"#;
    let output = Command::new("sh")
        .args(["-c", script])
        .output()
        .map_err(|e| format!("Failed to run foreground app detection: {e}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let mut parts = stdout.split('\t');
    let raw_name = clean_app_field(parts.next().unwrap_or_default());
    let process_id = parts
        .next()
        .and_then(|value| clean_app_field(value).parse::<u32>().ok());
    let executable_path = clean_app_field(parts.next().unwrap_or_default());
    let name = if raw_name.is_empty() {
        filename_stem(&executable_path).unwrap_or_default()
    } else {
        raw_name
    };
    let id = normalize_app_key(&name);
    if id.is_empty() {
        return Ok(None);
    }

    Ok(Some(ForegroundApplication {
        id,
        name,
        platform: get_platform(),
        process_id,
        bundle_id: None,
        executable_path: if executable_path.is_empty() {
            None
        } else {
            Some(executable_path)
        },
    }))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn detect_foreground_application_impl() -> Result<Option<ForegroundApplication>, String> {
    Ok(None)
}

pub(crate) fn detect_foreground_application() -> Result<Option<ForegroundApplication>, String> {
    detect_foreground_application_impl()
}

#[tauri::command]
pub fn get_foreground_application() -> CommandResult<Option<ForegroundApplication>> {
    detect_foreground_application().map_err(window_error)
}

fn clear_foreground_application_state(app: &AppHandle) -> Result<(), String> {
    super::privacy::clear_active_foreground_application(app)?;
    super::vocabulary::clear_active_application(app)
}

#[tauri::command]
pub fn sync_foreground_application_vocabulary(
    app: AppHandle,
) -> CommandResult<Option<ForegroundApplication>> {
    let foreground = match detect_foreground_application() {
        Ok(foreground) => foreground,
        Err(err) => {
            clear_foreground_application_state(&app).map_err(window_error)?;
            return Err(window_error(err));
        }
    };
    if let Some(application) = foreground.as_ref() {
        super::privacy::set_active_foreground_application(
            &app,
            &super::privacy::PrivacyForegroundApplication {
                id: application.id.clone(),
                name: application.name.clone(),
                platform: application.platform.clone(),
                process_id: application.process_id,
                bundle_id: application.bundle_id.clone(),
                executable_path: application.executable_path.clone(),
            },
        )
        .map_err(window_error)?;
        super::vocabulary::sync_active_application(&app, &application.id).map_err(window_error)?;
    } else {
        clear_foreground_application_state(&app).map_err(window_error)?;
    }
    Ok(foreground)
}

fn open_system_target(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg(target)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("Failed to open system target: {target}"));
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("cmd")
            .args(["/C", "start", "", target])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("Failed to open system target: {target}"));
    }

    #[cfg(target_os = "linux")]
    {
        let status = Command::new("xdg-open")
            .arg(target)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
        Err(format!("Failed to open system target: {target}"))
    }
}

#[tauri::command]
pub fn open_microphone_settings() -> CommandResult<()> {
    #[cfg(target_os = "macos")]
    {
        return open_system_target(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        )
        .map_err(window_error);
    }

    #[cfg(target_os = "windows")]
    {
        return open_system_target("ms-settings:privacy-microphone").map_err(window_error);
    }

    #[cfg(target_os = "linux")]
    {
        open_system_target("pavucontrol")
            .or_else(|_| open_system_target("gnome-control-center"))
            .map_err(|_| {
                window_error(
                    "Unable to open microphone settings automatically. Open your system sound settings manually.",
                )
            })
    }
}

#[tauri::command]
pub fn open_sound_input_settings() -> CommandResult<()> {
    #[cfg(target_os = "macos")]
    {
        return open_system_target("x-apple.systempreferences:com.apple.preference.sound?input")
            .map_err(window_error);
    }

    #[cfg(target_os = "windows")]
    {
        return open_system_target("ms-settings:sound").map_err(window_error);
    }

    #[cfg(target_os = "linux")]
    {
        open_system_target("pavucontrol")
            .or_else(|_| open_system_target("gnome-control-center"))
            .map_err(|_| {
                window_error(
                    "Unable to open sound settings automatically. Open your system sound settings manually.",
                )
            })
    }
}

#[tauri::command]
pub fn open_accessibility_settings() -> CommandResult<()> {
    #[cfg(target_os = "macos")]
    {
        return open_system_target(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        )
        .map_err(window_error);
    }

    #[cfg(target_os = "windows")]
    {
        return Err(window_error(
            "Accessibility settings are not applicable on Windows.",
        ));
    }

    #[cfg(target_os = "linux")]
    {
        return Err(window_error(
            "Accessibility settings are not applicable on Linux.",
        ));
    }
}
