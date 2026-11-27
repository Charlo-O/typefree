//! Agent panel window: a clickable, non-activating card above the recording overlay that shows
//! task progress, approval prompts, and the final answer. Unlike the recording overlay it accepts
//! mouse input, but it never takes keyboard focus away from the user's app, so "insert result"
//! still pastes into the field the user was typing in.

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager};

pub const AGENT_PANEL_LABEL: &str = "agent_panel";
const PANEL_URL: &str = "?agentPanel=true";
const PANEL_WIDTH: f64 = 400.0;
const DEFAULT_HEIGHT: f64 = 132.0;
const MIN_HEIGHT: f64 = 72.0;
const MAX_HEIGHT: f64 = 420.0;
const GAP_ABOVE_OVERLAY: f64 = 10.0;

static PANEL_HEIGHT_BITS: AtomicU64 = AtomicU64::new(0);

fn panel_height() -> f64 {
    match PANEL_HEIGHT_BITS.load(Ordering::Relaxed) {
        0 => DEFAULT_HEIGHT,
        bits => f64::from_bits(bits),
    }
}

/// Bottom-centered position (logical points) on the monitor under the cursor.
fn panel_position(app: &AppHandle, height: f64) -> Option<(f64, f64)> {
    #[cfg(target_os = "macos")]
    let monitor = crate::overlay::get_monitor_with_cursor(app)?;
    #[cfg(not(target_os = "macos"))]
    let monitor = app.primary_monitor().ok().flatten()?;

    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let width = area.size.width as f64 / scale;
    let area_height = area.size.height as f64 / scale;
    let x = area.position.x as f64 / scale + (width - PANEL_WIDTH) / 2.0;

    #[cfg(target_os = "macos")]
    let bottom_reserved = crate::overlay::OVERLAY_BOTTOM_OFFSET
        + crate::overlay::overlay_size(app).1
        + GAP_ABOVE_OVERLAY;
    #[cfg(not(target_os = "macos"))]
    let bottom_reserved = GAP_ABOVE_OVERLAY * 2.0;

    let y = area.position.y as f64 / scale + area_height - height - bottom_reserved;
    Some((x, y))
}

#[cfg(target_os = "macos")]
mod platform {
    use std::panic::AssertUnwindSafe;

    use objc2::exception;
    use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl};
    use tauri_nspanel::{
        tauri_panel, CollectionBehavior, ManagerExt as PanelManagerExt, PanelBuilder, PanelLevel,
        StyleMask,
    };

    use super::{AGENT_PANEL_LABEL, PANEL_URL, PANEL_WIDTH};

    tauri_panel! {
        panel!(AgentTaskPanel {
            config: {
                can_become_key_window: false,
                is_floating_panel: true
            }
        })
    }

    pub fn create(app: &AppHandle, x: f64, y: f64, height: f64) {
        let created = std::panic::catch_unwind(AssertUnwindSafe(|| {
            exception::catch(AssertUnwindSafe(|| {
                PanelBuilder::<_, AgentTaskPanel>::new(app, AGENT_PANEL_LABEL)
                    .url(WebviewUrl::App(PANEL_URL.into()))
                    .title("TypeFree Agent")
                    .position(Position::Logical(LogicalPosition { x, y }))
                    .level(PanelLevel::Status)
                    .size(Size::Logical(LogicalSize {
                        width: PANEL_WIDTH,
                        height,
                    }))
                    .has_shadow(false)
                    .hides_on_deactivate(false)
                    .transparent(true)
                    .no_activate(true)
                    .ignores_mouse_events(false)
                    .style_mask(StyleMask::empty().borderless().nonactivating_panel())
                    .collection_behavior(
                        CollectionBehavior::new()
                            .can_join_all_spaces()
                            .full_screen_auxiliary(),
                    )
                    .with_window(|w| {
                        w.decorations(false)
                            .transparent(true)
                            .resizable(false)
                            .shadow(false)
                            .skip_taskbar(true)
                            .accept_first_mouse(true)
                            .visible(false)
                    })
                    .build()
            }))
        }));
        match created {
            Ok(Ok(Ok(panel))) => {
                panel.hide();
                eprintln!("[agent-panel] created");
            }
            Ok(Ok(Err(error))) => eprintln!("[agent-panel] failed to create panel: {error}"),
            Ok(Err(exception)) => {
                eprintln!("[agent-panel] objc exception while creating panel: {exception:?}")
            }
            Err(_) => eprintln!("[agent-panel] panic while creating panel"),
        }
    }

    pub fn show(app: &AppHandle, position: Option<(f64, f64)>, height: f64) {
        let Some(window) = app.get_webview_window(AGENT_PANEL_LABEL) else {
            return;
        };
        let window_for_main = window.clone();
        let _ = window.run_on_main_thread(move || {
            let protected = exception::catch(AssertUnwindSafe(|| {
                let _ = window_for_main.set_size(Size::Logical(LogicalSize {
                    width: PANEL_WIDTH,
                    height,
                }));
                if let Some((x, y)) = position {
                    let _ =
                        window_for_main.set_position(Position::Logical(LogicalPosition { x, y }));
                }
                match window_for_main
                    .app_handle()
                    .get_webview_panel(AGENT_PANEL_LABEL)
                {
                    Ok(panel) => panel.show(),
                    Err(_) => {
                        let _ = window_for_main.show();
                    }
                }
                crate::commands::window::promote_webview_window_for_fullscreen(&window_for_main);
            }));
            if let Err(exception) = protected {
                eprintln!("[agent-panel] objc exception during show: {exception:?}");
            }
        });
    }

    pub fn hide(app: &AppHandle) {
        let Some(window) = app.get_webview_window(AGENT_PANEL_LABEL) else {
            return;
        };
        let window_for_main = window.clone();
        let _ = window.run_on_main_thread(move || {
            let protected = exception::catch(AssertUnwindSafe(|| {
                match window_for_main
                    .app_handle()
                    .get_webview_panel(AGENT_PANEL_LABEL)
                {
                    Ok(panel) => panel.hide(),
                    Err(_) => {
                        let _ = window_for_main.hide();
                    }
                }
            }));
            if let Err(exception) = protected {
                eprintln!("[agent-panel] objc exception during hide: {exception:?}");
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::{
        AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
    };

    use super::{AGENT_PANEL_LABEL, PANEL_URL, PANEL_WIDTH};

    pub fn create(app: &AppHandle, x: f64, y: f64, height: f64) {
        let result =
            WebviewWindowBuilder::new(app, AGENT_PANEL_LABEL, WebviewUrl::App(PANEL_URL.into()))
                .title("TypeFree Agent")
                .inner_size(PANEL_WIDTH, height)
                .position(x, y)
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .visible(false)
                .build();
        if let Err(error) = result {
            eprintln!("[agent-panel] failed to create window: {error}");
        }
    }

    pub fn show(app: &AppHandle, position: Option<(f64, f64)>, height: f64) {
        let Some(window) = app.get_webview_window(AGENT_PANEL_LABEL) else {
            return;
        };
        let _ = window.set_size(LogicalSize::new(PANEL_WIDTH, height));
        if let Some((x, y)) = position {
            let _ = window.set_position(LogicalPosition::new(x, y));
        }
        let _ = window.show();
    }

    pub fn hide(app: &AppHandle) {
        if let Some(window) = app.get_webview_window(AGENT_PANEL_LABEL) {
            let _ = window.hide();
        }
    }
}

fn ensure_created(app: &AppHandle) {
    if app.get_webview_window(AGENT_PANEL_LABEL).is_some() {
        return;
    }
    let height = panel_height();
    let (x, y) = panel_position(app, height).unwrap_or((100.0, 100.0));
    platform::create(app, x, y, height);
}

pub fn init_agent_panel(app: &AppHandle) {
    ensure_created(app);
}

pub fn show_agent_panel(app: &AppHandle) {
    ensure_created(app);
    let height = panel_height();
    platform::show(app, panel_position(app, height), height);
}

pub fn hide_agent_panel(app: &AppHandle) {
    platform::hide(app);
}

/// Called by the panel renderer after measuring its content.
pub fn resize_agent_panel(app: &AppHandle, height: f64) {
    if !height.is_finite() {
        return;
    }
    let height = height.clamp(MIN_HEIGHT, MAX_HEIGHT).round();
    PANEL_HEIGHT_BITS.store(height.to_bits(), Ordering::Relaxed);
    let visible = app
        .get_webview_window(AGENT_PANEL_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    if visible {
        platform::show(app, panel_position(app, height), height);
    }
}
