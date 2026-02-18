use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, Position, Size, WebviewUrl};

#[cfg(target_os = "macos")]
use objc2::exception;
#[cfg(target_os = "macos")]
use std::panic::AssertUnwindSafe;

// Handy-style: use an `NSPanel` (via `tauri-nspanel`) so the overlay can float above fullscreen
// apps and doesn't steal focus.
#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt as PanelManagerExt, PanelBuilder, PanelLevel,
    StyleMask,
};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(RecordingOverlayPanel {
        config: {
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

const OVERLAY_WINDOW_LABEL: &str = "recording_overlay";

const OVERLAY_WIDTH: f64 = 172.0;
const OVERLAY_HEIGHT: f64 = 36.0;
const OVERLAY_BOTTOM_OFFSET: f64 = 15.0;

#[cfg(target_os = "macos")]
fn create_overlay_panel_window(app: &AppHandle) {
    if app.get_webview_window(OVERLAY_WINDOW_LABEL).is_some() {
        return;
    }

    let (x, y) = match calculate_overlay_position(app) {
        Some(pos) => pos,
        None => {
            // We'll reposition on first show anyway, so don't fail creation here.
            eprintln!("[overlay] could not determine initial position; using fallback");
            (100.0, 100.0)
        }
    };

    // Protect against:
    // - Rust panics (PanelBuilder internally unwraps `to_panel()`).
    // - Objective-C exceptions (cannot unwind through Rust; would abort the process).
    let created = std::panic::catch_unwind(AssertUnwindSafe(|| {
        exception::catch(AssertUnwindSafe(|| {
            PanelBuilder::<_, RecordingOverlayPanel>::new(app, OVERLAY_WINDOW_LABEL)
                .url(WebviewUrl::App("?overlay=true".into()))
                .title("Recording")
                .position(Position::Logical(LogicalPosition { x, y }))
                .level(PanelLevel::Status)
                .size(Size::Logical(tauri::LogicalSize {
                    width: OVERLAY_WIDTH,
                    height: OVERLAY_HEIGHT,
                }))
                .has_shadow(false)
                .hides_on_deactivate(false)
                .transparent(true)
                .no_activate(true)
                .ignores_mouse_events(true)
                .style_mask(StyleMask::empty().borderless().nonactivating_panel())
                .collection_behavior(
                    CollectionBehavior::new()
                        .can_join_all_spaces()
                        .full_screen_auxiliary(),
                )
                .with_window(|w| {
                    // IMPORTANT: don't call `.always_on_top(true)` here; Tauri may re-apply its
                    // own window levels later. We rely on the NSPanel level instead.
                    w.decorations(false)
                        .transparent(true)
                        .resizable(false)
                        .shadow(false)
                        .skip_taskbar(true)
                        .visible(false)
                })
                .build()
        }))
    }));

    match created {
        Err(_) => {
            eprintln!("[overlay] panic while creating overlay panel window");
        }
        Ok(Err(exc)) => {
            eprintln!(
                "[overlay] objc exception while creating overlay panel window: {:?}",
                exc
            );
        }
        Ok(Ok(Ok(panel))) => {
            // Ensure it's hidden by default.
            panel.hide();
            eprintln!("[overlay] overlay panel created ({})", OVERLAY_WINDOW_LABEL);
        }
        Ok(Ok(Err(err))) => {
            eprintln!("[overlay] failed to create overlay panel window: {}", err);
        }
    }
}

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
        create_overlay_panel_window(app);
    }
}

pub fn show_recording_overlay(app: &AppHandle, state: OverlayState) {
    #[cfg(target_os = "macos")]
    {
        if app.get_webview_window(OVERLAY_WINDOW_LABEL).is_none() {
            // Best-effort: try to (re)create the overlay if it was not initialized (e.g. dev reload).
            create_overlay_panel_window(app);
        }

        let window = match app.get_webview_window(OVERLAY_WINDOW_LABEL) {
            Some(window) => window,
            None => {
                eprintln!(
                    "[overlay] overlay window '{}' not found; skipping show",
                    OVERLAY_WINDOW_LABEL
                );
                return;
            }
        };

        // Reposition each time in case user is on a different monitor.
        let pos = calculate_overlay_position(app);

        let window_for_mt = window.clone();
        let result = window.run_on_main_thread(move || {
            // ObjC exceptions MUST be caught before they reach tao/tauri catch_unwind wrappers,
            // otherwise the process aborts ("Rust cannot catch foreign exceptions").
            let protected = exception::catch(AssertUnwindSafe(|| {
                let panel = window_for_mt
                    .app_handle()
                    .get_webview_panel(OVERLAY_WINDOW_LABEL)
                    .ok();

                if let Some((x, y)) = pos {
                    eprintln!("[overlay] show {:?} at ({:.1}, {:.1})", state, x, y);
                    let _ =
                        window_for_mt.set_position(Position::Logical(LogicalPosition { x, y }));
                } else {
                    eprintln!("[overlay] show {:?} (position unknown)", state);
                }

                // Ensure size stays in sync with overlay UI.
                let _ = window_for_mt.set_size(Size::Logical(tauri::LogicalSize {
                    width: OVERLAY_WIDTH,
                    height: OVERLAY_HEIGHT,
                }));

                if let Some(panel) = panel {
                    panel.show();
                } else {
                    // Fallback: regular window show.
                    let _ = window_for_mt.show();
                }

                // Re-assert native fullscreen/Spaces behavior. This is safe and internally
                // catches ObjC exceptions.
                crate::commands::window::promote_webview_window_for_fullscreen(&window_for_mt);

                let _ = window_for_mt.emit("show-overlay", state);
            }));

            if let Err(exc) = protected {
                eprintln!("[overlay] objc exception during show: {:?}", exc);

                // Best-effort fallback: try to show the regular window to avoid getting stuck
                // in recording with no visible UI.
                let _ = exception::catch(AssertUnwindSafe(|| {
                    let _ = window_for_mt.show();
                }));
            }
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
        let window = match app.get_webview_window(OVERLAY_WINDOW_LABEL) {
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
                let protected = exception::catch(AssertUnwindSafe(|| {
                    let panel = window_for_mt2
                        .app_handle()
                        .get_webview_panel(OVERLAY_WINDOW_LABEL)
                        .ok();
                    if let Some(panel) = panel {
                        panel.hide();
                    } else {
                        let _ = window_for_mt2.hide();
                    }
                }));

                if let Err(exc) = protected {
                    eprintln!("[overlay] objc exception during hide: {:?}", exc);
                    let _ = window_for_mt2.hide();
                }
            });
        });
    }
}
