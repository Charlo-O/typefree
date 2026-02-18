mod clipboard_listener;
mod commands;
mod overlay;

use commands::{
    clipboard, database, hotkey, logging, reasoning, recording, settings, transcription, window,
};

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
        .invoke_handler(tauri::generate_handler![
            // Clipboard commands
            clipboard::paste_text,
            clipboard::paste_image,
            clipboard::read_clipboard,
            clipboard::write_clipboard,
            clipboard::write_clipboard_image,
            // Database commands
            database::db_save_transcription,
            database::db_get_transcriptions,
            database::db_delete_transcription,
            database::db_clear_transcriptions,
            // Settings commands
            settings::get_setting,
            settings::set_setting,
            settings::get_env_var,
            settings::set_env_var,
            settings::get_all_settings,
            // Transcription commands
            transcription::transcribe_audio,
            transcription::get_transcription_providers,
            // Native recording commands (macOS only; returns error on other platforms)
            recording::start_native_recording,
            recording::stop_native_recording,
            recording::cancel_native_recording,
            // Window commands
            window::show_dictation_panel,
            window::show_control_panel,
            window::hide_window,
            window::show_window,
            window::start_drag,
            window::get_platform,
            // Hotkey commands
            hotkey::register_hotkey,
            hotkey::unregister_hotkeys,
            // Reasoning commands
            reasoning::process_anthropic_reasoning,
            // Logging commands
            logging::write_renderer_log,
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

            // Initialize database on startup
            database::init_database(app.handle())?;

            // Start clipboard monitoring (text + images) and broadcast updates to renderer.
            clipboard_listener::start(app.handle().clone());

            // Backend dictation coordinator (macOS hotkey path).
            commands::dictation::init_dictation_coordinator(app.handle());

            // Handy-style recording overlay (non-activating panel on macOS).
            overlay::init_recording_overlay(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
