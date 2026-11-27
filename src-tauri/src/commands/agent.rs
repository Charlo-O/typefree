//! Tauri command facade for the voice agent (`crate::agent`).

use tauri::AppHandle;

use super::command_error::{CommandError, CommandResult};
use crate::agent::codex::ApprovalDecision;
use crate::agent::runtime::{self, AgentBackendStatus, AgentTaskSnapshot, TaskSource};

#[tauri::command]
pub async fn agent_get_status(app: AppHandle) -> CommandResult<AgentBackendStatus> {
    Ok(runtime::backend_status(&app).await)
}

#[tauri::command]
pub fn agent_get_current_task(app: AppHandle) -> CommandResult<Option<AgentTaskSnapshot>> {
    Ok(runtime::current_task(&app))
}

#[tauri::command]
pub fn agent_start_task(app: AppHandle, prompt: String) -> CommandResult<String> {
    runtime::start_task(&app, &prompt, TaskSource::default()).map_err(CommandError::from_message)
}

#[tauri::command]
pub async fn agent_cancel_task(app: AppHandle, task_id: String) -> CommandResult<()> {
    runtime::cancel_task(&app, &task_id)
        .await
        .map_err(CommandError::from_message)
}

#[tauri::command]
pub async fn agent_respond_approval(
    app: AppHandle,
    task_id: String,
    request_key: String,
    decision: String,
) -> CommandResult<()> {
    let decision = ApprovalDecision::parse(&decision).ok_or_else(|| {
        CommandError::configuration(format!("Unknown approval decision: {decision}"))
    })?;
    runtime::respond_approval(&app, &task_id, &request_key, decision)
        .await
        .map_err(CommandError::from_message)
}

#[tauri::command]
pub fn agent_insert_result(app: AppHandle, task_id: String) -> CommandResult<()> {
    runtime::insert_result(&app, &task_id).map_err(CommandError::from_message)
}

#[tauri::command]
pub fn agent_dismiss_panel(app: AppHandle) -> CommandResult<()> {
    crate::agent::panel::hide_agent_panel(&app);
    Ok(())
}

#[tauri::command]
pub fn agent_resize_panel(app: AppHandle, height: f64) -> CommandResult<()> {
    crate::agent::panel::resize_agent_panel(&app, height);
    Ok(())
}
