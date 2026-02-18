use tauri::PhysicalPosition;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};

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

        try_objc("setCollectionBehavior", |ns_window| {
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

        try_objc("setHidesOnDeactivate(false)", |ns_window| {
            ns_window.setHidesOnDeactivate(false);
        });

        // Escalate window level to reliably show above fullscreen apps.
        try_objc("setLevel(NSPopUpMenuWindowLevel)+orderFrontRegardless", |ns_window| {
            ns_window.setLevel(NSPopUpMenuWindowLevel);
            ns_window.orderFrontRegardless();
        });

        // If still not visible/active, try another level toggle.
        try_objc("level_toggle_fallback", |ns_window| {
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

fn move_webview_to_bottom_right(window: &WebviewWindow) -> Result<(), String> {
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
        "[window] move(webview) cursor={:?} monitor_pos=({}, {}) monitor_size=({}, {}) target=({}, {})",
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

pub(crate) fn reveal_window(window: &Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Most macOS window operations (especially fullscreen/Spaces behavior) are much more
        // reliable when performed on the main thread.
        if window.label() == "main" {
            return reveal_main_window(&window.app_handle());
        }
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

            #[cfg(target_os = "macos")]
            {
                let _ = main_window_for_mt.set_visible_on_all_workspaces(true);
                let _ = main_window_for_mt.set_always_on_top(true);
            }

            let _ = main_window_for_mt.show();

            #[cfg(target_os = "macos")]
            {
                // Re-position after showing so we use the final, DPI-scaled outer size.
                let _ = move_webview_to_bottom_right(&main_window_for_mt);

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
pub fn show_dictation_panel(window: Window) -> Result<(), String> {
    reveal_window(&window)
}

/// Show the control panel window
#[tauri::command]
pub fn show_control_panel(app: AppHandle) -> Result<(), String> {
    // Try to get existing window first
    if let Some(window) = app.get_webview_window("control") {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();
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
    reveal_window(&window)
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
