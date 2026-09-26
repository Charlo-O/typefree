mod app_data_migration;
mod clipboard_images;
mod clipboard_listener;
mod commands;
pub(crate) mod local_asr;
mod overlay;
mod transcription;

use commands::{
    audio_ducking, clipboard, credentials, database, hotkey, logging, privacy, reasoning,
    recording, settings, transcription as transcription_commands, transcription_openai_realtime,
    transcription_volcengine, window,
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::WindowEvent;

const TRAY_OPEN_CONTROL_PANEL_ID: &str = "tray_open_control_panel";
const TRAY_QUIT_ID: &str = "tray_quit";

fn show_control_panel_from_tray(app: tauri::AppHandle) {
    if let Err(err) = window::show_control_panel(app) {
        eprintln!("[tray] failed to show control panel: {}", err);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init());

    // Required by tauri-nspanel: registers WebviewPanelManager state.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_OPEN_CONTROL_PANEL_ID => {
                show_control_panel_from_tray(app.clone());
            }
            TRAY_QUIT_ID => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|app, event| {
            let should_show_control_panel = matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            );

            if should_show_control_panel {
                show_control_panel_from_tray(app.clone());
            }
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            if window.label() == "control" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(err) = window.hide() {
                        eprintln!("[window] failed to hide control panel to tray: {}", err);
                    }
                } else if matches!(event, WindowEvent::Resized(_))
                    && window.is_minimized().unwrap_or(false)
                {
                    if let Err(err) = window.hide() {
                        eprintln!(
                            "[window] failed to hide minimized control panel to tray: {}",
                            err
                        );
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Clipboard commands
            clipboard::paste_text,
            clipboard::paste_image,
            clipboard::read_clipboard,
            clipboard::write_clipboard,
            clipboard::write_clipboard_image,
            clipboard::store_clipboard_image,
            clipboard::delete_clipboard_image_files,
            clipboard::check_paste_tools,
            clipboard::check_accessibility_permission,
            // Database commands
            database::db_save_transcription,
            database::db_save_transcription_record,
            database::db_get_transcriptions,
            database::db_search_transcriptions,
            database::db_get_transcription_outputs,
            database::db_get_transcription_session,
            database::db_save_dictation_timeline_events,
            database::db_get_dictation_timeline_sessions,
            database::db_delete_transcription,
            database::db_clear_transcriptions,
            database::db_prune_transcription_history,
            // Settings commands
            settings::get_setting,
            settings::set_setting,
            settings::get_env_var,
            settings::set_env_var,
            settings::get_all_settings,
            // Credential commands
            credentials::get_credential,
            credentials::get_credential_status,
            credentials::set_credential,
            credentials::delete_credential,
            // Transcription commands
            transcription_commands::transcribe_audio,
            transcription_commands::get_transcription_providers,
            local_asr::commands::local_asr_check_runtime,
            local_asr::commands::local_asr_transcribe,
            transcription_volcengine::start_volcengine_streaming_transcription,
            transcription_volcengine::send_volcengine_streaming_audio,
            transcription_volcengine::finish_volcengine_streaming_transcription,
            transcription_volcengine::cancel_volcengine_streaming_transcription,
            transcription_openai_realtime::start_openai_realtime_transcription,
            transcription_openai_realtime::send_openai_realtime_audio,
            transcription_openai_realtime::finish_openai_realtime_transcription,
            transcription_openai_realtime::cancel_openai_realtime_transcription,
            // Native recording commands (platform-specific backend with renderer fallback)
            recording::start_native_recording,
            recording::stop_native_recording,
            recording::cancel_native_recording,
            recording::get_native_recording_capabilities,
            // Audio ducking commands
            audio_ducking::start_audio_ducking,
            audio_ducking::stop_audio_ducking,
            // Window commands
            window::show_dictation_panel,
            window::show_control_panel,
            window::hide_window,
            window::quit_app,
            window::show_window,
            window::start_drag,
            window::get_platform,
            window::get_foreground_application,
            window::sync_foreground_application_vocabulary,
            window::open_microphone_settings,
            window::open_sound_input_settings,
            window::open_accessibility_settings,
            // Hotkey commands
            hotkey::register_hotkey,
            hotkey::register_hotkeys,
            hotkey::unregister_hotkeys,
            // Reasoning commands
            reasoning::process_anthropic_reasoning,
            // Logging commands
            logging::write_renderer_log,
            logging::get_debug_state,
            logging::set_debug_logging,
            logging::open_logs_folder,
            // Privacy diagnostics
            privacy::privacy_diagnostics,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;

                // Configure autostart plugin (used by Settings -> "Launch at startup").
                app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    None,
                ))?;
            }

            // Preserve local state when moving away from the legacy bundle identifier.
            app_data_migration::migrate_legacy_app_data_dirs(app.handle())?;

            // Initialize database on startup
            database::init_database(app.handle())?;

            // If TypeFree exited while recording, restore the user's previous output mute state.
            audio_ducking::recover_stale_mute(app.handle());

            // Start clipboard monitoring (text + images) and broadcast updates to renderer.
            clipboard_listener::start(app.handle().clone());

            // Backend dictation coordinator (macOS hotkey path).
            commands::dictation::init_dictation_coordinator(app.handle());

            // Handy-style recording overlay (non-activating panel on macOS).
            overlay::init_recording_overlay(app.handle());

            if let Some(tray) = app.tray_by_id("main") {
                let open = MenuItem::with_id(
                    app,
                    TRAY_OPEN_CONTROL_PANEL_ID,
                    "Open TypeFree",
                    true,
                    None::<&str>,
                )?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Exit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open, &separator, &quit])?;

                tray.set_menu(Some(menu))?;
                tray.set_tooltip(Some("TypeFree"))?;
                let _ = tray.set_show_menu_on_left_click(false);
            } else {
                eprintln!("[tray] main tray icon not found; tray menu was not attached");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
