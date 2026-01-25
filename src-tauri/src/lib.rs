mod commands;

use commands::{clipboard, database, hotkey, settings, transcription, window};

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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
