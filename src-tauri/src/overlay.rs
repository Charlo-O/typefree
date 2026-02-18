use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, Position, Size, WebviewUrl};

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel};

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
    Idle,
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
        if app.get_webview_window("recording_overlay").is_some() {
            return;
        }

        let Some((x, y)) = calculate_overlay_position(app) else {
            eprintln!("[overlay] failed to determine overlay position; skipping overlay init");
            return;
        };

        // Handy-style: create a non-activating NSPanel so the indicator shows on top of fullscreen
        // apps and never steals focus from the active app.
        match PanelBuilder::<_, RecordingOverlayPanel>::new(app, "recording_overlay")
            .url(WebviewUrl::App("?overlay=true".into()))
            .title("Typefree")
            .position(Position::Logical(LogicalPosition { x, y }))
            .level(PanelLevel::Status)
            .size(Size::Logical(tauri::LogicalSize {
                width: OVERLAY_WIDTH,
                height: OVERLAY_HEIGHT,
            }))
            .has_shadow(false)
            .transparent(true)
            .no_activate(true)
            .ignores_mouse_events(true) // click-through
            .hides_on_deactivate(false) // keep visible while user types in another app
            .corner_radius(0.0)
            .with_window(|w| {
                w.decorations(false)
                    .transparent(true)
                    .resizable(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    .shadow(false)
            })
            .collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .full_screen_auxiliary(),
            )
            .build()
        {
            Ok(panel) => {
                panel.hide();
            }
            Err(err) => {
                eprintln!("[overlay] failed to create recording overlay: {}", err);
            }
        }
    }
}

pub fn show_recording_overlay(app: &AppHandle, state: OverlayState) {
    #[cfg(target_os = "macos")]
    {
        // Best-effort: even if panel init failed, keep dictation working.
        let window = match app.get_webview_window("recording_overlay") {
            Some(window) => window,
            None => {
                eprintln!("[overlay] recording_overlay window not found; skipping show");
                return;
            }
        };

        // Reposition each time in case user is on a different monitor.
        if let Some((x, y)) = calculate_overlay_position(app) {
            eprintln!("[overlay] show {:?} at ({:.1}, {:.1})", state, x, y);
            let _ = window.set_position(Position::Logical(LogicalPosition { x, y }));
        } else {
            eprintln!("[overlay] show {:?} (position unknown)", state);
        }

        // Handy-style: show the Tauri window (it is backed by an NSPanel due to PanelBuilder +
        // `.no_activate(true)`), which is safe to call from any thread.
        let _ = window.show();

        let _ = window.emit("show-overlay", state);

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
        let window = match app.get_webview_window("recording_overlay") {
            Some(window) => window,
            None => return,
        };

        eprintln!("[overlay] hide");

        // Let the renderer run a fade-out animation before hiding the panel.
        let _ = window.emit("hide-overlay", ());

        let window_for_task = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = window_for_task.hide();
        });
    }
}
