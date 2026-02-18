use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, Position, Size};

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, ManagerExt as _, PanelLevel, WebviewWindowExt};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(RecordingOverlayPanel {
        config: {
            // Don't steal focus from the app the user is dictating into.
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayState {
    Recording,
    Transcribing,
    Processing,
}

const OVERLAY_WIDTH: f64 = 172.0;
const OVERLAY_HEIGHT: f64 = 36.0;
const OVERLAY_BOTTOM_OFFSET: f64 = 15.0;

#[cfg(target_os = "macos")]
fn get_monitor_with_cursor(app: &AppHandle) -> Option<tauri::Monitor> {
    let cursor = app.cursor_position().ok();
    if let Some(cursor) = cursor {
        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            return Some(monitor);
        }
    }

    app.primary_monitor().ok().flatten()
}

// Returns logical (point) coordinates.
#[cfg(target_os = "macos")]
fn calculate_overlay_position(app: &AppHandle) -> Option<(f64, f64)> {
    let monitor = get_monitor_with_cursor(app)?;

    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();

    // Convert physical pixels -> logical points so position matches window logical sizing.
    let work_area_width = work_area.size.width as f64 / scale;
    let work_area_height = work_area.size.height as f64 / scale;
    let work_area_x = work_area.position.x as f64 / scale;
    let work_area_y = work_area.position.y as f64 / scale;

    let x = work_area_x + (work_area_width - OVERLAY_WIDTH) / 2.0;
    let y = work_area_y + work_area_height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_OFFSET;

    Some((x, y))
}

pub fn init_recording_overlay(app: &AppHandle) {
    // Best-effort: keep dictation working even if overlay fails.
    #[cfg(target_os = "macos")]
    {
        // We intentionally re-use the existing `main` window as the overlay window (no extra
        // `recording_overlay` window), but apply Handy-style NSPanel behavior to it.
        let Some(main_window) = app.get_webview_window("main") else {
            eprintln!("[overlay] main window not found; skipping overlay init");
            return;
        };

        // If already converted, just ensure it starts hidden.
        if app.get_webview_panel("main").is_ok() {
            let _ = main_window.hide();
            return;
        }

        let app_handle = app.clone();
        let main_for_mt = main_window.clone();
        let result = main_window.run_on_main_thread(move || {
            let panel = match main_for_mt.to_panel::<RecordingOverlayPanel>() {
                Ok(panel) => panel,
                Err(err) => {
                    eprintln!("[overlay] failed to convert main window to panel: {}", err);
                    return;
                }
            };

            panel.set_level(PanelLevel::Status.value());
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .full_screen_auxiliary()
                    .value(),
            );
            panel.set_hides_on_deactivate(false);
            panel.set_has_shadow(false);
            panel.set_transparent(true);
            panel.set_ignores_mouse_events(true); // click-through

            // Best-effort: size/position the window while hidden to avoid a visible "jump".
            let _ = main_for_mt.set_size(Size::Logical(tauri::LogicalSize {
                width: OVERLAY_WIDTH,
                height: OVERLAY_HEIGHT,
            }));
            if let Some((x, y)) = calculate_overlay_position(&app_handle) {
                let _ = main_for_mt.set_position(Position::Logical(LogicalPosition { x, y }));
            }

            let _ = main_for_mt.hide();
        });
        if let Err(err) = result {
            eprintln!("[overlay] run_on_main_thread(init) failed: {}", err);
        }
    }
}

pub fn show_recording_overlay(app: &AppHandle, state: OverlayState) {
    #[cfg(target_os = "macos")]
    {
        // Best-effort: even if panel init failed, keep dictation working.
        let window = match app.get_webview_window("main") {
            Some(window) => window,
            None => {
                eprintln!("[overlay] main window not found; skipping show");
                return;
            }
        };

        // Reposition each time in case user is on a different monitor.
        let pos = calculate_overlay_position(app);

        let window_for_mt = window.clone();
        let result = window.run_on_main_thread(move || {
            if let Some((x, y)) = pos {
                eprintln!("[overlay] show {:?} at ({:.1}, {:.1})", state, x, y);
                let _ = window_for_mt.set_position(Position::Logical(LogicalPosition { x, y }));
            } else {
                eprintln!("[overlay] show {:?} (position unknown)", state);
            }

            // Ensure size stays in sync with overlay UI.
            let _ = window_for_mt.set_size(Size::Logical(tauri::LogicalSize {
                width: OVERLAY_WIDTH,
                height: OVERLAY_HEIGHT,
            }));

            let _ = window_for_mt.show();
            let _ = window_for_mt.emit("show-overlay", state);
        });
        if let Err(err) = result {
            eprintln!("[overlay] run_on_main_thread(show) failed: {}", err);
        }

        // In dev/hot-reload scenarios, the renderer listener might not be registered yet when we
        // emit. Re-emit shortly after to make the overlay more reliable.
        let window_for_retry = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let _ = window_for_retry.emit("show-overlay", state);
        });
    }
}

pub fn hide_recording_overlay(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let window = match app.get_webview_window("main") {
            Some(window) => window,
            None => return,
        };

        eprintln!("[overlay] hide");

        let window_for_mt = window.clone();
        let result = window.run_on_main_thread(move || {
            // Let the renderer run a fade-out animation before hiding the panel.
            let _ = window_for_mt.emit("hide-overlay", ());
        });
        if let Err(err) = result {
            eprintln!("[overlay] run_on_main_thread(hide emit) failed: {}", err);
        }

        let window_for_task = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let window_for_mt2 = window_for_task.clone();
            let _ = window_for_task.run_on_main_thread(move || {
                let _ = window_for_mt2.hide();
            });
        });
    }
}
