use tauri::AppHandle;

use super::command_error::CommandResult;

/// Start a low-latency OpenAI realtime transcription session.
///
/// Audio is expected to be 24 kHz mono PCM16, matching OpenAI's realtime
/// transcription session format.
#[tauri::command]
pub async fn start_openai_realtime_transcription(
    app: AppHandle,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
    delay: Option<String>,
) -> CommandResult<String> {
    crate::transcription::openai_realtime::start_openai_realtime_transcription(
        app, api_key, model, language, delay,
    )
    .await
}

#[tauri::command]
pub async fn send_openai_realtime_audio(
    session_id: String,
    audio_data: Vec<u8>,
) -> CommandResult<()> {
    crate::transcription::openai_realtime::send_openai_realtime_audio(session_id, audio_data).await
}

#[tauri::command]
pub async fn finish_openai_realtime_transcription(session_id: String) -> CommandResult<String> {
    crate::transcription::openai_realtime::finish_openai_realtime_transcription(session_id).await
}

#[tauri::command]
pub async fn cancel_openai_realtime_transcription(session_id: String) -> CommandResult<()> {
    crate::transcription::openai_realtime::cancel_openai_realtime_transcription(session_id).await
}
