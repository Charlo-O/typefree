import type { DictationPhase } from "../../../shared/platform";

export type DictationSessionState = {
  sessionId: string | null;
  phase: DictationPhase;
  lastText: string;
  error: string | null;
  cancelledSessionId: string | null;
  updatedAt: number;
};

export type DictationSessionEvent =
  | { type: "start"; sessionId: string }
  | { type: "recording"; sessionId: string }
  | { type: "transcribing"; sessionId: string }
  | { type: "postprocessing"; sessionId: string }
  | { type: "inserting"; sessionId: string }
  | { type: "completed"; sessionId: string; text?: string }
  | { type: "failed"; sessionId: string; error?: string }
  | { type: "cancelled"; sessionId: string }
  | {
      type: "backend-state";
      sessionId: string;
      phase: DictationPhase;
      text?: string;
      error?: string;
    }
  | { type: "reset" };

const ALLOWED_PHASE_TRANSITIONS: Record<DictationPhase, ReadonlySet<DictationPhase>> = {
  idle: new Set(["idle", "recording", "transcribing", "completed", "failed"]),
  recording: new Set(["idle", "recording", "transcribing", "failed"]),
  transcribing: new Set([
    "idle",
    "transcribing",
    "postprocessing",
    "inserting",
    "completed",
    "failed",
  ]),
  postprocessing: new Set(["idle", "postprocessing", "inserting", "completed", "failed"]),
  inserting: new Set(["idle", "inserting", "completed", "failed"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
};

export function isDictationRecordingPhase(phase: DictationPhase): boolean {
  return phase === "recording";
}

export function isDictationProcessingPhase(phase: DictationPhase): boolean {
  return phase === "transcribing" || phase === "postprocessing" || phase === "inserting";
}

export function isDictationTerminalPhase(phase: DictationPhase): boolean {
  return phase === "idle" || phase === "completed" || phase === "failed";
}

export function createDictationSessionId(source = "renderer"): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${source}-${random}`;
}

export function createInitialDictationSession(): DictationSessionState {
  return {
    sessionId: null,
    phase: "idle",
    lastText: "",
    error: null,
    cancelledSessionId: null,
    updatedAt: Date.now(),
  };
}

function isNewSessionStartingPhase(phase: DictationPhase): boolean {
  return phase === "recording" || phase === "transcribing";
}

function shouldAcceptSessionEvent(
  state: DictationSessionState,
  event: Exclude<DictationSessionEvent, { type: "reset" }>
): boolean {
  if (state.cancelledSessionId === event.sessionId) {
    return false;
  }

  if (!state.sessionId || state.sessionId === event.sessionId) {
    return true;
  }

  return isDictationTerminalPhase(state.phase) && isNewSessionStartingPhase(getEventPhase(event));
}

function getEventPhase(event: Exclude<DictationSessionEvent, { type: "reset" }>): DictationPhase {
  switch (event.type) {
    case "start":
    case "recording":
      return "recording";
    case "transcribing":
      return "transcribing";
    case "postprocessing":
      return "postprocessing";
    case "inserting":
      return "inserting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "idle";
    case "backend-state":
      return event.phase;
  }
}

export function canTransitionDictationSession(
  state: DictationSessionState,
  event: Exclude<DictationSessionEvent, { type: "reset" }>
): boolean {
  if (!shouldAcceptSessionEvent(state, event)) {
    return false;
  }

  if (state.sessionId && state.sessionId !== event.sessionId) {
    return true;
  }

  const nextPhase = getEventPhase(event);
  return ALLOWED_PHASE_TRANSITIONS[state.phase].has(nextPhase);
}

function nextState(
  state: DictationSessionState,
  sessionId: string,
  phase: DictationPhase,
  patch: Partial<Pick<DictationSessionState, "lastText" | "error" | "cancelledSessionId">> = {}
): DictationSessionState {
  return {
    sessionId,
    phase,
    lastText: patch.lastText ?? state.lastText,
    error: patch.error ?? (phase === "failed" ? state.error : null),
    cancelledSessionId: patch.cancelledSessionId ?? null,
    updatedAt: Date.now(),
  };
}

export function reduceDictationSession(
  state: DictationSessionState,
  event: DictationSessionEvent
): DictationSessionState {
  if (event.type === "reset") {
    return createInitialDictationSession();
  }

  if (!canTransitionDictationSession(state, event)) {
    return state;
  }

  switch (event.type) {
    case "start":
    case "recording":
      return nextState(state, event.sessionId, "recording", { lastText: "", error: null });
    case "transcribing":
      return nextState(state, event.sessionId, "transcribing");
    case "postprocessing":
      return nextState(state, event.sessionId, "postprocessing");
    case "inserting":
      return nextState(state, event.sessionId, "inserting");
    case "completed":
      return nextState(state, event.sessionId, "completed", {
        lastText: event.text ?? state.lastText,
        error: null,
      });
    case "failed":
      return nextState(state, event.sessionId, "failed", {
        error: event.error || "Unknown dictation error",
      });
    case "cancelled":
      return nextState(state, event.sessionId, "idle", {
        lastText: "",
        error: null,
        cancelledSessionId: event.sessionId,
      });
    case "backend-state": {
      const startsNewSession = state.sessionId !== event.sessionId;
      const shouldClearText =
        event.phase === "recording" ||
        (startsNewSession && (event.phase === "transcribing" || event.phase === "postprocessing"));
      return nextState(state, event.sessionId, event.phase, {
        lastText: shouldClearText ? "" : (event.text ?? state.lastText),
        error: event.error ?? null,
      });
    }
  }
}
