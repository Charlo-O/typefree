use tauri::AppHandle;

use super::command_error::CommandResult;

#[tauri::command]
pub async fn start_volcengine_streaming_transcription(
    app: AppHandle,
    app_id: String,
    access_token: String,
    resource_id: Option<String>,
    model: Option<String>,
    language: Option<String>,
) -> CommandResult<String> {
    crate::transcription::volcengine::streaming::start_volcengine_streaming_transcription(
        app,
        app_id,
        access_token,
        resource_id,
        model,
        language,
    )
    .await
}

#[tauri::command]
pub async fn send_volcengine_streaming_audio(
    session_id: String,
    audio_data: Vec<u8>,
) -> CommandResult<()> {
    crate::transcription::volcengine::streaming::send_volcengine_streaming_audio(
        session_id, audio_data,
    )
    .await
}

#[tauri::command]
pub async fn finish_volcengine_streaming_transcription(
    session_id: String,
) -> CommandResult<String> {
    crate::transcription::volcengine::streaming::finish_volcengine_streaming_transcription(
        session_id,
    )
    .await
}

#[tauri::command]
pub async fn cancel_volcengine_streaming_transcription(session_id: String) -> CommandResult<()> {
    crate::transcription::volcengine::streaming::cancel_volcengine_streaming_transcription(
        session_id,
    )
    .await
}
