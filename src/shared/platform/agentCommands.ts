import { hasTauriRuntime, normalizeCommandError } from "./commandCore";
import type {
  AgentApprovalDecision,
  AgentBackendStatus,
  AgentTaskSnapshot,
  PlatformUnlisten,
} from "./types";

const AGENT_TASK_EVENT = "agent-task-updated";

async function invokeAgent<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error("The voice agent requires the TypeFree desktop app");
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke(command, args)) as T;
  } catch (error: unknown) {
    throw normalizeCommandError(error);
  }
}

export function agentGetStatus(): Promise<AgentBackendStatus> {
  return invokeAgent<AgentBackendStatus>("agent_get_status");
}

export async function agentGetCurrentTask(): Promise<AgentTaskSnapshot | null> {
  if (!hasTauriRuntime()) return null;
  return invokeAgent<AgentTaskSnapshot | null>("agent_get_current_task");
}

export function agentStartTask(prompt: string): Promise<string> {
  return invokeAgent<string>("agent_start_task", { prompt });
}

export function agentCancelTask(taskId: string): Promise<void> {
  return invokeAgent<void>("agent_cancel_task", { taskId });
}

export function agentRespondApproval(
  taskId: string,
  requestKey: string,
  decision: AgentApprovalDecision
): Promise<void> {
  return invokeAgent<void>("agent_respond_approval", { taskId, requestKey, decision });
}

export function agentInsertResult(taskId: string): Promise<void> {
  return invokeAgent<void>("agent_insert_result", { taskId });
}

export function agentDismissPanel(): Promise<void> {
  return invokeAgent<void>("agent_dismiss_panel");
}

export function agentResizePanel(height: number): Promise<void> {
  return invokeAgent<void>("agent_resize_panel", { height });
}

export async function onAgentTaskUpdated(
  callback: (snapshot: AgentTaskSnapshot) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<AgentTaskSnapshot>(AGENT_TASK_EVENT, (event) => callback(event.payload));
  } catch (error) {
    console.warn("onAgentTaskUpdated failed:", error);
    return () => {};
  }
}
