mod commands;

use commands::{clipboard, database, hotkey, settings, transcription, window};
use tauri::{Manager, PhysicalPosition};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            // Clipboard commands
            clipboard::paste_text,
            clipboard::read_clipboard,
            clipboard::write_clipboard,
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
            // Window commands
            window::show_dictation_panel,
            window::show_control_panel,
            window::hide_window,
            window::start_drag,
            window::get_platform,
            // Hotkey commands
            hotkey::register_hotkey,
            hotkey::unregister_hotkeys,
        ])
        .setup(|app| {
            // Initialize database on startup
            database::init_database(app.handle())?;

            // Position the main (floating) window at the bottom-right of the desktop.
            if let Some(main_window) = app.get_webview_window("main") {
                let monitor = main_window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .or_else(|| main_window.primary_monitor().ok().flatten());

                if let Some(monitor) = monitor {
                    let monitor_pos = monitor.position();
                    let monitor_size = monitor.size();
                    let window_size = main_window.outer_size().or_else(|_| main_window.inner_size());

                    if let Ok(window_size) = window_size {
                        let margin_x: i32 = 24;
                        let margin_y: i32 = if cfg!(target_os = "windows") { 72 } else { 24 };

                        let x = monitor_pos.x
                            + monitor_size.width as i32
                            - window_size.width as i32
                            - margin_x;
                        let y = monitor_pos.y
                            + monitor_size.height as i32
                            - window_size.height as i32
                            - margin_y;

                        let _ = main_window.set_position(PhysicalPosition::new(
                            x.max(monitor_pos.x),
                            y.max(monitor_pos.y),
                        ));
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
