//! Voice agent runtime: owns the long-lived `codex app-server` process, the single active task,
//! and the approval queue that the agent panel answers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;

use super::codex::{
    self, ApprovalDecision, ApprovalKind, Incoming, PromptContext, SafetyLevel, ServerRequest,
    TurnStatus,
};
use super::executable::{self, ResolvedExecutable};

pub const AGENT_TASK_EVENT: &str = "agent-task-updated";

const STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const INTERRUPT_GRACE: Duration = Duration::from_secs(8);
const TASK_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const VERSION_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_STEPS: usize = 30;
const MAX_STDERR_LOG_CHARS: usize = 400;

static NEXT_CONNECTION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentTaskStatus {
    Starting,
    Running,
    AwaitingApproval,
    Completed,
    Failed,
    Cancelled,
}

impl AgentTaskStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    fn history_status(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            _ => "failed",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalView {
    pub request_key: String,
    pub kind: ApprovalKind,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub reason: Option<String>,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskSnapshot {
    pub task_id: String,
    pub status: AgentTaskStatus,
    pub prompt: String,
    pub activity: Option<String>,
    pub message: String,
    pub steps: Vec<String>,
    pub approval: Option<AgentApprovalView>,
    pub pending_approvals: usize,
    pub error: Option<String>,
    /// Machine-readable notice for the panel ("busy", "approvalTimedOut", "stopping").
    pub notice: Option<String>,
    pub started_at_ms: u64,
    pub finished_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBackendStatus {
    pub available: bool,
    pub backend: &'static str,
    pub executable_path: Option<String>,
    pub executable_source: Option<&'static str>,
    pub version: Option<String>,
    pub working_directory: String,
    pub safety_level: &'static str,
    pub error: Option<String>,
}

/// Where a task came from, used for history rows.
#[derive(Debug, Clone, Default)]
pub struct TaskSource {
    pub session_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub language: Option<String>,
}

struct PendingApproval {
    rpc_id: Value,
    kind: ApprovalKind,
    view: AgentApprovalView,
}

#[derive(Debug, Clone)]
struct TurnOutcome {
    status: TurnStatus,
    error: Option<String>,
}

struct TaskState {
    snapshot: AgentTaskSnapshot,
    source: TaskSource,
    connection_id: Option<u64>,
    thread_id: Option<String>,
    turn_id: Option<String>,
    approvals: Vec<PendingApproval>,
    agent_messages: Vec<(String, String)>,
    last_error: Option<String>,
    cancel_requested: bool,
    done_tx: Option<oneshot::Sender<TurnOutcome>>,
}

impl TaskState {
    fn new(task_id: String, prompt: String, source: TaskSource) -> Self {
        Self {
            snapshot: AgentTaskSnapshot {
                task_id,
                status: AgentTaskStatus::Starting,
                prompt,
                activity: None,
                message: String::new(),
                steps: Vec::new(),
                approval: None,
                pending_approvals: 0,
                error: None,
                notice: None,
                started_at_ms: now_ms(),
                finished_at_ms: None,
            },
            source,
            connection_id: None,
            thread_id: None,
            turn_id: None,
            approvals: Vec::new(),
            agent_messages: Vec::new(),
            last_error: None,
            cancel_requested: false,
            done_tx: None,
        }
    }

    fn refresh_approval_view(&mut self) {
        self.snapshot.approval = self.approvals.first().map(|approval| approval.view.clone());
        self.snapshot.pending_approvals = self.approvals.len();
        if self.snapshot.status.is_terminal() {
            return;
        }
        self.snapshot.status = if self.approvals.is_empty() {
            if self.turn_id.is_some() {
                AgentTaskStatus::Running
            } else {
                AgentTaskStatus::Starting
            }
        } else {
            AgentTaskStatus::AwaitingApproval
        };
    }

    fn push_step(&mut self, step: String) {
        if self.snapshot.steps.last() == Some(&step) {
            return;
        }
        self.snapshot.steps.push(step);
        if self.snapshot.steps.len() > MAX_STEPS {
            let overflow = self.snapshot.steps.len() - MAX_STEPS;
            self.snapshot.steps.drain(..overflow);
        }
    }

    fn set_agent_message(&mut self, item_id: &str, text: String) {
        match self.agent_messages.iter_mut().find(|(id, _)| id == item_id) {
            Some(entry) => entry.1 = text.clone(),
            None => self
                .agent_messages
                .push((item_id.to_string(), text.clone())),
        }
        self.snapshot.message = text;
    }

    fn append_agent_delta(&mut self, item_id: &str, delta: &str) {
        let text = self
            .agent_messages
            .iter()
            .find(|(id, _)| id == item_id)
            .map(|(_, text)| format!("{text}{delta}"))
            .unwrap_or_else(|| delta.to_string());
        self.set_agent_message(item_id, text);
    }
}

pub struct CodexConnection {
    id: u64,
    executable: PathBuf,
    stdin: tokio::sync::Mutex<ChildStdin>,
    child: tokio::sync::Mutex<Child>,
    pending: Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>,
    next_request_id: AtomicI64,
    alive: AtomicBool,
}

impl CodexConnection {
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    async fn write(&self, message: Value) -> Result<(), String> {
        let mut line = serde_json::to_string(&message).map_err(|error| error.to_string())?;
        line.push('\n');
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|error| format!("failed to write to codex app-server: {error}"))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("failed to flush codex app-server stdin: {error}"))
    }

    async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        if !self.is_alive() {
            return Err("codex app-server is not running".to_string());
        }
        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        lock(&self.pending).insert(id, tx);
        if let Err(error) = self
            .write(json!({ "id": id, "method": method, "params": params }))
            .await
        {
            lock(&self.pending).remove(&id);
            return Err(error);
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("codex app-server exited".to_string()),
            Err(_) => {
                lock(&self.pending).remove(&id);
                Err(format!("codex app-server request '{method}' timed out"))
            }
        }
    }

    async fn notify(&self, method: &str) -> Result<(), String> {
        self.write(json!({ "method": method })).await
    }

    async fn respond(&self, id: Value, result: Value) -> Result<(), String> {
        self.write(json!({ "id": id, "result": result })).await
    }

    async fn respond_error(&self, id: Value, message: String) -> Result<(), String> {
        self.write(json!({ "id": id, "error": { "code": -32601, "message": message } }))
            .await
    }

    fn mark_closed(&self) {
        self.alive.store(false, Ordering::SeqCst);
        let pending: Vec<_> = lock(&self.pending).drain().map(|(_, tx)| tx).collect();
        for tx in pending {
            let _ = tx.send(Err("codex app-server exited".to_string()));
        }
    }

    async fn shutdown(&self) {
        self.mark_closed();
        let _ = self.child.lock().await.start_kill();
    }
}

#[derive(Default)]
pub struct AgentRuntime {
    connection: tokio::sync::Mutex<Option<Arc<CodexConnection>>>,
    task: Mutex<Option<TaskState>>,
}

struct AgentSettings {
    codex_path: Option<String>,
    working_directory: PathBuf,
    safety: SafetyLevel,
}

impl AgentSettings {
    fn load(app: &AppHandle) -> Self {
        let read = |key: &str| {
            crate::commands::settings::get_setting_value(app.clone(), key.to_string())
                .ok()
                .flatten()
                .and_then(|value| value.as_str().map(str::trim).map(str::to_string))
                .filter(|value| !value.is_empty())
        };
        let home = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
        let working_directory = match read("agentWorkingDirectory") {
            Some(path) => match path.strip_prefix("~/") {
                Some(rest) => home.join(rest),
                None => PathBuf::from(path),
            },
            None => home.join("TypeFree Agent"),
        };
        Self {
            codex_path: read("agentCodexPath"),
            working_directory,
            safety: SafetyLevel::from_setting(read("agentSafetyLevel").as_deref()),
        }
    }

    fn safety_label(&self) -> &'static str {
        match self.safety {
            SafetyLevel::Balanced => "balanced",
            SafetyLevel::Strict => "strict",
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn runtime(app: &AppHandle) -> tauri::State<'_, AgentRuntime> {
    if app.try_state::<AgentRuntime>().is_none() {
        app.manage(AgentRuntime::default());
    }
    app.state::<AgentRuntime>()
}

fn emit_snapshot(app: &AppHandle, snapshot: &AgentTaskSnapshot) {
    if let Err(error) = app.emit(AGENT_TASK_EVENT, snapshot) {
        eprintln!("[agent] failed to emit task update: {error}");
    }
}

/// Applies `update` to the task with `task_id` (if it is still current) and emits the result.
fn update_task<R>(
    app: &AppHandle,
    task_id: &str,
    update: impl FnOnce(&mut TaskState) -> R,
) -> Option<R> {
    let (result, snapshot) = {
        let state = runtime(app);
        let mut guard = lock(&state.task);
        let task = guard
            .as_mut()
            .filter(|task| task.snapshot.task_id == task_id)?;
        let result = update(task);
        (result, task.snapshot.clone())
    };
    emit_snapshot(app, &snapshot);
    Some(result)
}

pub fn current_task(app: &AppHandle) -> Option<AgentTaskSnapshot> {
    lock(&runtime(app).task)
        .as_ref()
        .map(|task| task.snapshot.clone())
}

fn ensure_working_directory(settings: &AgentSettings) -> Result<String, String> {
    std::fs::create_dir_all(&settings.working_directory).map_err(|error| {
        format!(
            "failed to create agent working directory {}: {error}",
            settings.working_directory.display()
        )
    })?;
    settings
        .working_directory
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| "agent working directory must be valid UTF-8".to_string())
}

fn configure_child(command: &mut Command, resolved: &ResolvedExecutable) {
    command.env("PATH", &resolved.child_path).kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

async fn spawn_connection(
    app: &AppHandle,
    resolved: &ResolvedExecutable,
    cwd: &Path,
) -> Result<Arc<CodexConnection>, String> {
    let mut command = Command::new(&resolved.path);
    command
        .arg("app-server")
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_child(&mut command, resolved);

    let mut child = command.spawn().map_err(|error| {
        format!(
            "failed to start codex app-server ({}): {error}",
            resolved.path.display()
        )
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or("codex app-server stdin unavailable")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("codex app-server stdout unavailable")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("codex app-server stderr unavailable")?;

    let connection = Arc::new(CodexConnection {
        id: NEXT_CONNECTION_ID.fetch_add(1, Ordering::SeqCst),
        executable: resolved.path.clone(),
        stdin: tokio::sync::Mutex::new(stdin),
        child: tokio::sync::Mutex::new(child),
        pending: Mutex::new(HashMap::new()),
        next_request_id: AtomicI64::new(1),
        alive: AtomicBool::new(true),
    });
    eprintln!(
        "[agent] codex app-server started ({}, connection {})",
        resolved.path.display(),
        connection.id
    );

    let weak = Arc::downgrade(&connection);
    let app_for_reader = app.clone();
    let connection_id = connection.id;
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Some(connection) = weak.upgrade() else {
                break;
            };
            handle_line(&app_for_reader, &connection, &line).await;
        }
        if let Some(connection) = weak.upgrade() {
            connection.mark_closed();
        }
        on_connection_closed(&app_for_reader, connection_id);
    });

    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line: String = line.chars().take(MAX_STDERR_LOG_CHARS).collect();
            if !line.trim().is_empty() {
                eprintln!("[agent] codex: {line}");
            }
        }
    });

    let version = app.package_info().version.to_string();
    if let Err(error) = connection
        .request(
            "initialize",
            codex::initialize_params(&version),
            STARTUP_TIMEOUT,
        )
        .await
    {
        connection.shutdown().await;
        return Err(format!("codex app-server initialize failed: {error}"));
    }
    if let Err(error) = connection.notify("initialized").await {
        connection.shutdown().await;
        return Err(error);
    }
    Ok(connection)
}

async fn ensure_connection(
    app: &AppHandle,
    settings: &AgentSettings,
    cwd: &Path,
) -> Result<Arc<CodexConnection>, String> {
    let resolved = executable::resolve_codex(settings.codex_path.as_deref())?;
    let state = runtime(app);
    let mut slot = state.connection.lock().await;
    if let Some(existing) = slot.as_ref() {
        if existing.is_alive() && existing.executable == resolved.path {
            return Ok(existing.clone());
        }
        existing.shutdown().await;
    }
    let connection = spawn_connection(app, &resolved, cwd).await?;
    *slot = Some(connection.clone());
    Ok(connection)
}

async fn live_connection(
    app: &AppHandle,
    connection_id: Option<u64>,
) -> Option<Arc<CodexConnection>> {
    let state = runtime(app);
    let slot = state.connection.lock().await;
    slot.as_ref()
        .filter(|connection| connection.is_alive() && Some(connection.id) == connection_id)
        .cloned()
}

async fn handle_line(app: &AppHandle, connection: &Arc<CodexConnection>, line: &str) {
    match codex::classify_line(line) {
        Some(Incoming::Response { id, result }) => {
            if let Some(tx) = lock(&connection.pending).remove(&id) {
                let _ = tx.send(result);
            }
        }
        Some(Incoming::Request { id, method, params }) => {
            on_server_request(app, connection, id, &method, &params).await;
        }
        Some(Incoming::Notification { method, params }) => {
            on_notification(app, connection.id, &method, &params);
        }
        None => {}
    }
}

fn on_connection_closed(app: &AppHandle, connection_id: u64) {
    eprintln!("[agent] codex app-server connection {connection_id} closed");
    let done = {
        let state = runtime(app);
        let mut guard = lock(&state.task);
        guard
            .as_mut()
            .filter(|task| {
                task.connection_id == Some(connection_id) && !task.snapshot.status.is_terminal()
            })
            .and_then(|task| task.done_tx.take())
    };
    if let Some(tx) = done {
        let _ = tx.send(TurnOutcome {
            status: TurnStatus::Failed,
            error: Some("Codex app-server exited unexpectedly".to_string()),
        });
    }
}

fn param_str<'a>(params: &'a Value, key: &str) -> Option<&'a str> {
    params.get(key).and_then(Value::as_str)
}

fn on_notification(app: &AppHandle, connection_id: u64, method: &str, params: &Value) {
    if !matches!(
        method,
        "turn/started"
            | "turn/completed"
            | "item/started"
            | "item/completed"
            | "item/agentMessage/delta"
            | "error"
            | "serverRequest/resolved"
    ) {
        return;
    }
    let thread_id = param_str(params, "threadId");

    let (snapshot, done) = {
        let state = runtime(app);
        let mut guard = lock(&state.task);
        let Some(task) = guard.as_mut().filter(|task| {
            task.connection_id == Some(connection_id)
                && task.thread_id.as_deref().is_some()
                && task.thread_id.as_deref() == thread_id
                && !task.snapshot.status.is_terminal()
        }) else {
            return;
        };

        let mut done = None;
        match method {
            "turn/started" => {
                if let Some(turn_id) = params.pointer("/turn/id").and_then(Value::as_str) {
                    task.turn_id = Some(turn_id.to_string());
                }
                task.refresh_approval_view();
            }
            "item/started" => {
                let item = &params["item"];
                if let Some(line) = codex::describe_item(item) {
                    if item.get("type").and_then(Value::as_str) != Some("reasoning") {
                        task.push_step(line.clone());
                    }
                    task.snapshot.activity = Some(line);
                }
            }
            "item/agentMessage/delta" => {
                if let (Some(item_id), Some(delta)) =
                    (param_str(params, "itemId"), param_str(params, "delta"))
                {
                    task.append_agent_delta(item_id, delta);
                }
            }
            "item/completed" => {
                let item = &params["item"];
                if item.get("type").and_then(Value::as_str) == Some("agentMessage") {
                    if let (Some(item_id), Some(text)) =
                        (param_str(item, "id"), param_str(item, "text"))
                    {
                        task.set_agent_message(item_id, text.to_string());
                    }
                }
            }
            "error" => {
                let will_retry = params
                    .get("willRetry")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !will_retry {
                    task.last_error = params
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
            }
            "serverRequest/resolved" => {
                if let Some(request_id) = params.get("requestId") {
                    task.approvals
                        .retain(|approval| &approval.rpc_id != request_id);
                    task.refresh_approval_view();
                }
            }
            "turn/completed" => {
                let turn = &params["turn"];
                let outcome = TurnOutcome {
                    status: codex::parse_turn_status(turn),
                    error: codex::turn_error_message(turn).or_else(|| task.last_error.clone()),
                };
                done = task.done_tx.take().map(|tx| (tx, outcome));
            }
            _ => {}
        }
        (task.snapshot.clone(), done)
    };

    if let Some((tx, outcome)) = done {
        let _ = tx.send(outcome);
    }
    emit_snapshot(app, &snapshot);
}

async fn on_server_request(
    app: &AppHandle,
    connection: &Arc<CodexConnection>,
    id: Value,
    method: &str,
    params: &Value,
) {
    let request = match codex::parse_server_request(method, params) {
        ServerRequest::AutoAnswer(result) => {
            let _ = connection.respond(id, result).await;
            return;
        }
        ServerRequest::Unsupported => {
            let _ = connection
                .respond_error(id, format!("TypeFree does not support {method}"))
                .await;
            return;
        }
        ServerRequest::Approval(request) => request,
    };

    let request_key = uuid::Uuid::new_v4().to_string();
    let accepted = {
        let state = runtime(app);
        let mut guard = lock(&state.task);
        guard
            .as_mut()
            .filter(|task| {
                task.connection_id == Some(connection.id)
                    && task.thread_id.is_some()
                    && task.thread_id == request.thread_id
                    && !task.snapshot.status.is_terminal()
                    && !task.cancel_requested
            })
            .map(|task| {
                task.approvals.push(PendingApproval {
                    rpc_id: id.clone(),
                    kind: request.kind,
                    view: AgentApprovalView {
                        request_key: request_key.clone(),
                        kind: request.kind,
                        command: request.command.clone(),
                        cwd: request.cwd.clone(),
                        reason: request.reason.clone(),
                        files: request.files.clone(),
                    },
                });
                task.refresh_approval_view();
                (task.snapshot.task_id.clone(), task.snapshot.clone())
            })
    };

    let Some((task_id, snapshot)) = accepted else {
        let _ = connection
            .respond(
                id,
                codex::approval_response(request.kind, ApprovalDecision::Decline),
            )
            .await;
        return;
    };
    emit_snapshot(app, &snapshot);
    super::panel::show_agent_panel(app);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(APPROVAL_TIMEOUT).await;
        let still_pending = lock(&runtime(&app).task)
            .as_ref()
            .filter(|task| task.snapshot.task_id == task_id)
            .map(|task| {
                task.approvals
                    .iter()
                    .any(|approval| approval.view.request_key == request_key)
            })
            .unwrap_or(false);
        if still_pending {
            update_task(&app, &task_id, |task| {
                task.snapshot.notice = Some("approvalTimedOut".to_string());
            });
            let _ = respond_approval(&app, &task_id, &request_key, ApprovalDecision::Decline).await;
        }
    });
}

/// Starts a new agent task for a spoken command. Only one task runs at a time.
pub fn start_task(app: &AppHandle, transcript: &str, source: TaskSource) -> Result<String, String> {
    let transcript = transcript.trim();
    if transcript.is_empty() {
        return Err("No voice command was recognized.".to_string());
    }

    let task_id = uuid::Uuid::new_v4().to_string();
    let snapshot = {
        let state = runtime(app);
        let mut guard = lock(&state.task);
        if let Some(existing) = guard
            .as_mut()
            .filter(|task| !task.snapshot.status.is_terminal())
        {
            existing.snapshot.notice = Some("busy".to_string());
            let snapshot = existing.snapshot.clone();
            drop(guard);
            emit_snapshot(app, &snapshot);
            super::panel::show_agent_panel(app);
            return Err("Another agent task is still running.".to_string());
        }
        let task = TaskState::new(task_id.clone(), transcript.to_string(), source);
        let snapshot = task.snapshot.clone();
        *guard = Some(task);
        snapshot
    };
    emit_snapshot(app, &snapshot);
    super::panel::show_agent_panel(app);

    let app = app.clone();
    let task_id_for_driver = task_id.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = run_task(&app, &task_id_for_driver).await;
        finish_task(&app, &task_id_for_driver, outcome).await;
    });
    Ok(task_id)
}

fn cancel_requested(app: &AppHandle, task_id: &str) -> bool {
    lock(&runtime(app).task)
        .as_ref()
        .filter(|task| task.snapshot.task_id == task_id)
        .map(|task| task.cancel_requested)
        .unwrap_or(true)
}

fn cancelled_outcome() -> TurnOutcome {
    TurnOutcome {
        status: TurnStatus::Interrupted,
        error: None,
    }
}

async fn capture_context() -> PromptContext {
    let foreground_app = tokio::task::spawn_blocking(|| {
        crate::commands::window::detect_foreground_application()
            .ok()
            .flatten()
            .map(|application| match application.bundle_id {
                Some(bundle_id) if !bundle_id.is_empty() => {
                    format!("{} ({bundle_id})", application.name)
                }
                _ => application.name,
            })
    })
    .await
    .ok()
    .flatten();
    PromptContext { foreground_app }
}

async fn run_task(app: &AppHandle, task_id: &str) -> Result<TurnOutcome, String> {
    let settings = AgentSettings::load(app);
    let cwd = ensure_working_directory(&settings)?;
    let context = capture_context().await;
    let connection = ensure_connection(app, &settings, Path::new(&cwd)).await?;
    if cancel_requested(app, task_id) {
        return Ok(cancelled_outcome());
    }

    let thread = connection
        .request(
            "thread/start",
            codex::thread_start_params(&cwd, settings.safety),
            REQUEST_TIMEOUT,
        )
        .await?;
    let thread_id = thread
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .ok_or("codex app-server did not return a thread id")?
        .to_string();

    let (done_tx, done_rx) = oneshot::channel();
    let prompt = update_task(app, task_id, |task| {
        task.connection_id = Some(connection.id);
        task.thread_id = Some(thread_id.clone());
        task.done_tx = Some(done_tx);
        (!task.cancel_requested).then(|| task.snapshot.prompt.clone())
    })
    .flatten();
    let Some(prompt) = prompt else {
        return Ok(cancelled_outcome());
    };

    let turn = connection
        .request(
            "turn/start",
            codex::turn_start_params(&thread_id, &codex::build_user_prompt(&prompt, &context)),
            REQUEST_TIMEOUT,
        )
        .await?;
    let turn_id = turn
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .map(str::to_string);
    let interrupt_now = update_task(app, task_id, |task| {
        if task.turn_id.is_none() {
            task.turn_id = turn_id.clone();
        }
        task.refresh_approval_view();
        task.cancel_requested
    })
    .unwrap_or(true);
    if interrupt_now {
        if let Some(turn_id) = turn_id.as_deref() {
            let _ = connection
                .request(
                    "turn/interrupt",
                    codex::turn_interrupt_params(&thread_id, turn_id),
                    REQUEST_TIMEOUT,
                )
                .await;
        }
    }

    match tokio::time::timeout(TASK_TIMEOUT, done_rx).await {
        Ok(Ok(outcome)) => Ok(outcome),
        Ok(Err(_)) => Err("Codex app-server exited before the task finished".to_string()),
        Err(_) => {
            if let Some(turn_id) = turn_id.as_deref() {
                let _ = connection
                    .request(
                        "turn/interrupt",
                        codex::turn_interrupt_params(&thread_id, turn_id),
                        REQUEST_TIMEOUT,
                    )
                    .await;
            }
            Err("The agent task timed out".to_string())
        }
    }
}

async fn finish_task(app: &AppHandle, task_id: &str, outcome: Result<TurnOutcome, String>) {
    let finished = update_task(app, task_id, |task| {
        let cancelled = task.cancel_requested;
        let (status, error) = match outcome {
            Ok(TurnOutcome {
                status: TurnStatus::Completed,
                ..
            }) => (AgentTaskStatus::Completed, None),
            Ok(TurnOutcome {
                status: TurnStatus::Interrupted,
                ..
            }) => (AgentTaskStatus::Cancelled, None),
            Ok(TurnOutcome { error, .. }) if cancelled => (AgentTaskStatus::Cancelled, error),
            Ok(TurnOutcome { error, .. }) => (
                AgentTaskStatus::Failed,
                Some(error.unwrap_or_else(|| "The agent task failed".to_string())),
            ),
            Err(_) if cancelled => (AgentTaskStatus::Cancelled, None),
            Err(error) => (AgentTaskStatus::Failed, Some(error)),
        };
        task.snapshot.status = status;
        task.snapshot.error = error;
        task.snapshot.activity = None;
        if task.snapshot.notice.as_deref() != Some("approvalTimedOut") {
            task.snapshot.notice = None;
        }
        task.snapshot.finished_at_ms = Some(now_ms());
        task.done_tx = None;
        let leftovers = std::mem::take(&mut task.approvals);
        task.refresh_approval_view();
        (
            task.snapshot.clone(),
            task.source.clone(),
            task.connection_id,
            leftovers,
        )
    });
    let Some((snapshot, source, connection_id, leftovers)) = finished else {
        return;
    };

    if !leftovers.is_empty() {
        if let Some(connection) = live_connection(app, connection_id).await {
            for approval in leftovers {
                let _ = connection
                    .respond(
                        approval.rpc_id,
                        codex::approval_response(approval.kind, ApprovalDecision::Decline),
                    )
                    .await;
            }
        }
    }

    super::panel::show_agent_panel(app);
    save_history(app, &snapshot, &source);
    eprintln!(
        "[agent] task {} finished: {:?}{}",
        snapshot.task_id,
        snapshot.status,
        snapshot
            .error
            .as_deref()
            .map(|error| format!(" ({error})"))
            .unwrap_or_default()
    );
}

fn save_history(app: &AppHandle, snapshot: &AgentTaskSnapshot, source: &TaskSource) {
    let message = snapshot.message.trim().to_string();
    let metadata_json = serde_json::to_string(&json!({
        "backend": "codex",
        "status": snapshot.status,
        "steps": snapshot.steps,
        "durationMs": snapshot
            .finished_at_ms
            .map(|finished| finished.saturating_sub(snapshot.started_at_ms)),
    }))
    .ok();
    let request = crate::commands::database::SaveTranscriptionRecordRequest {
        text: snapshot.prompt.clone(),
        processed: (!message.is_empty()).then(|| message.clone()),
        method: Some("agent-codex".to_string()),
        agent_name: None,
        session_id: source.session_id.clone(),
        provider: source.provider.clone(),
        model: source.model.clone(),
        language: source.language.clone(),
        status: Some(snapshot.status.history_status().to_string()),
        error: snapshot.error.clone(),
        outputs: Some(vec![crate::commands::database::TranscriptionOutputInput {
            stage: "agent".to_string(),
            text: message,
            metadata_json,
        }]),
    };
    if let Err(error) = crate::commands::database::db_save_transcription_record_value(app, request)
    {
        eprintln!("[agent] failed to save task history: {error}");
    }
}

pub async fn respond_approval(
    app: &AppHandle,
    task_id: &str,
    request_key: &str,
    decision: ApprovalDecision,
) -> Result<(), String> {
    let taken = update_task(app, task_id, |task| {
        let index = task
            .approvals
            .iter()
            .position(|approval| approval.view.request_key == request_key)?;
        let approval = task.approvals.remove(index);
        if decision == ApprovalDecision::Cancel {
            task.cancel_requested = true;
            task.snapshot.notice = Some("stopping".to_string());
        }
        task.refresh_approval_view();
        Some((approval, task.connection_id))
    })
    .flatten();
    let Some((approval, connection_id)) = taken else {
        return Err("This approval request is no longer pending.".to_string());
    };
    let connection = live_connection(app, connection_id)
        .await
        .ok_or("Codex app-server is no longer running.")?;
    connection
        .respond(
            approval.rpc_id,
            codex::approval_response(approval.kind, decision),
        )
        .await
}

pub async fn cancel_task(app: &AppHandle, task_id: &str) -> Result<(), String> {
    let taken = update_task(app, task_id, |task| {
        if task.snapshot.status.is_terminal() {
            return None;
        }
        task.cancel_requested = true;
        task.snapshot.notice = Some("stopping".to_string());
        let approvals = std::mem::take(&mut task.approvals);
        task.refresh_approval_view();
        Some((
            approvals,
            task.connection_id,
            task.thread_id.clone(),
            task.turn_id.clone(),
        ))
    })
    .flatten();
    let Some((approvals, connection_id, thread_id, turn_id)) = taken else {
        return Ok(());
    };

    if let Some(connection) = live_connection(app, connection_id).await {
        for approval in approvals {
            let _ = connection
                .respond(
                    approval.rpc_id,
                    codex::approval_response(approval.kind, ApprovalDecision::Cancel),
                )
                .await;
        }
        if let (Some(thread_id), Some(turn_id)) = (thread_id, turn_id) {
            if let Err(error) = connection
                .request(
                    "turn/interrupt",
                    codex::turn_interrupt_params(&thread_id, &turn_id),
                    REQUEST_TIMEOUT,
                )
                .await
            {
                eprintln!("[agent] turn/interrupt failed: {error}");
            }
        }
    }

    // If Codex never reports the interrupted turn, finish the task ourselves.
    let app = app.clone();
    let task_id = task_id.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(INTERRUPT_GRACE).await;
        let done = lock(&runtime(&app).task)
            .as_mut()
            .filter(|task| task.snapshot.task_id == task_id)
            .and_then(|task| task.done_tx.take());
        if let Some(tx) = done {
            let _ = tx.send(cancelled_outcome());
        }
    });
    Ok(())
}

/// Pastes the finished task's final message into the focused application.
pub fn insert_result(app: &AppHandle, task_id: &str) -> Result<(), String> {
    let message = lock(&runtime(app).task)
        .as_ref()
        .filter(|task| task.snapshot.task_id == task_id && task.snapshot.status.is_terminal())
        .map(|task| task.snapshot.message.trim().to_string())
        .filter(|message| !message.is_empty())
        .ok_or("There is no agent result to insert.")?;
    super::panel::hide_agent_panel(app);
    crate::commands::clipboard::paste_text(app.clone(), message).map_err(|error| error.message)
}

/// Starts the app-server ahead of time (e.g. when the agent hotkey starts recording) so the
/// task does not pay the CLI startup cost after the user stops speaking.
pub fn prewarm(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let settings = AgentSettings::load(&app);
        let result = match ensure_working_directory(&settings) {
            Ok(cwd) => ensure_connection(&app, &settings, Path::new(&cwd))
                .await
                .map(|_| ()),
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            eprintln!("[agent] prewarm failed: {error}");
        }
    });
}

pub async fn backend_status(app: &AppHandle) -> AgentBackendStatus {
    let settings = AgentSettings::load(app);
    let mut status = AgentBackendStatus {
        available: false,
        backend: "codex",
        executable_path: None,
        executable_source: None,
        version: None,
        working_directory: settings.working_directory.display().to_string(),
        safety_level: settings.safety_label(),
        error: None,
    };
    let resolved = match executable::resolve_codex(settings.codex_path.as_deref()) {
        Ok(resolved) => resolved,
        Err(error) => {
            status.error = Some(error);
            return status;
        }
    };
    status.executable_path = Some(resolved.path.display().to_string());
    status.executable_source = Some(resolved.source);

    let mut command = Command::new(&resolved.path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_child(&mut command, &resolved);
    match tokio::time::timeout(VERSION_TIMEOUT, command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            status.available = true;
            status.version = Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
        Ok(Ok(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            status.error = Some(if stderr.is_empty() {
                format!("codex --version exited with {}", output.status)
            } else {
                stderr
            });
        }
        Ok(Err(error)) => status.error = Some(format!("failed to run codex: {error}")),
        Err(_) => status.error = Some("codex --version timed out".to_string()),
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task() -> TaskState {
        TaskState::new(
            "t".to_string(),
            "打开计算器".to_string(),
            TaskSource::default(),
        )
    }

    fn approval(key: &str) -> PendingApproval {
        PendingApproval {
            rpc_id: json!(key),
            kind: ApprovalKind::Command,
            view: AgentApprovalView {
                request_key: key.to_string(),
                kind: ApprovalKind::Command,
                command: Some("open -a Calculator".to_string()),
                cwd: None,
                reason: None,
                files: Vec::new(),
            },
        }
    }

    #[test]
    fn approval_queue_drives_status() {
        let mut task = task();
        task.turn_id = Some("turn".to_string());
        task.approvals.push(approval("a"));
        task.approvals.push(approval("b"));
        task.refresh_approval_view();
        assert_eq!(task.snapshot.status, AgentTaskStatus::AwaitingApproval);
        assert_eq!(task.snapshot.pending_approvals, 2);
        assert_eq!(
            task.snapshot
                .approval
                .as_ref()
                .map(|view| view.request_key.as_str()),
            Some("a")
        );

        task.approvals.clear();
        task.refresh_approval_view();
        assert_eq!(task.snapshot.status, AgentTaskStatus::Running);
        assert!(task.snapshot.approval.is_none());
    }

    #[test]
    fn terminal_status_is_not_overwritten_by_approval_refresh() {
        let mut task = task();
        task.snapshot.status = AgentTaskStatus::Completed;
        task.approvals.push(approval("a"));
        task.refresh_approval_view();
        assert_eq!(task.snapshot.status, AgentTaskStatus::Completed);
    }

    #[test]
    fn agent_message_deltas_accumulate_per_item() {
        let mut task = task();
        task.append_agent_delta("m1", "已打开");
        task.append_agent_delta("m1", "计算器。");
        assert_eq!(task.snapshot.message, "已打开计算器。");
        task.set_agent_message("m2", "完成".to_string());
        assert_eq!(task.snapshot.message, "完成");
        task.set_agent_message("m1", "已打开计算器。".to_string());
        assert_eq!(task.agent_messages.len(), 2);
    }

    #[test]
    fn steps_are_deduplicated_and_capped() {
        let mut task = task();
        task.push_step("$ ls".to_string());
        task.push_step("$ ls".to_string());
        assert_eq!(task.snapshot.steps.len(), 1);
        for index in 0..(MAX_STEPS + 5) {
            task.push_step(format!("$ echo {index}"));
        }
        assert_eq!(task.snapshot.steps.len(), MAX_STEPS);
        assert_eq!(
            task.snapshot.steps.last().map(String::as_str),
            Some(format!("$ echo {}", MAX_STEPS + 4).as_str())
        );
    }
}
