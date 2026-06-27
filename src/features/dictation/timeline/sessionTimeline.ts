import platform, { type BackendTimelineEvent, type DictationPhase } from "../../../shared/platform";
import type { CompletionPipelineStep } from "../pipeline/completionPipeline";
import type { TranscriptionPipelineStep } from "../pipeline/transcriptionPipeline";

export type DictationTimelineKind =
  | "session"
  | "input"
  | "state"
  | "transcription"
  | "postprocessing"
  | "completion"
  | "insert"
  | "history"
  | "backend"
  | "error";

export type DictationTimelineStatus =
  | "started"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "info";

export interface DictationTimelineEventInput {
  kind: DictationTimelineKind;
  label: string;
  status?: DictationTimelineStatus;
  phase?: DictationPhase;
  source?: string;
  durationMs?: number | null;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface DictationTimelineEvent extends DictationTimelineEventInput {
  id: string;
  sessionId: string;
  at: string;
  elapsedMs: number;
  status: DictationTimelineStatus;
}

export interface DictationTimelineSession {
  sessionId: string;
  source: string;
  startedAt: string;
  updatedAt: string;
  events: DictationTimelineEvent[];
}

type PipelineStep = CompletionPipelineStep | TranscriptionPipelineStep;

const TIMELINE_STORAGE_KEY = "dictation.sessionTimeline";
const MAX_SESSIONS = 25;
const MAX_EVENTS_PER_SESSION = 240;
const pendingTimelinePersistence = new Set<Promise<unknown>>();

function getStorage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage;
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readRawSessions(): DictationTimelineSession[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(TIMELINE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: DictationTimelineSession[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Timeline diagnostics are best-effort.
  }
}

function sessionStartedAtMs(session: DictationTimelineSession): number {
  const parsed = Date.parse(session.startedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function updateSessionList(updated: DictationTimelineSession): DictationTimelineSession[] {
  const sessions = readRawSessions().filter((session) => session.sessionId !== updated.sessionId);
  return [updated, ...sessions].slice(0, MAX_SESSIONS);
}

function shouldPersistEvent(event: DictationTimelineEvent): boolean {
  return (
    String(event.source || "")
      .trim()
      .toLowerCase() !== "backend"
  );
}

function toPersistedTimelineEvent(event: DictationTimelineEvent): BackendTimelineEvent {
  return {
    kind: event.kind,
    label: event.label,
    status: event.status,
    phase: event.phase,
    source: event.source,
    durationMs: event.durationMs ?? undefined,
    detail: event.detail,
    meta: event.meta,
    at: event.at,
    elapsedMs: event.elapsedMs,
  };
}

function persistTimelineEvent(sessionId: string, event: DictationTimelineEvent): void {
  if (!sessionId || !shouldPersistEvent(event)) {
    return;
  }

  const saveTimelineEvents = platform?.history?.saveDictationTimelineEvents;
  if (typeof saveTimelineEvents !== "function") {
    return;
  }

  try {
    const pending = Promise.resolve(
      saveTimelineEvents(sessionId, event.source || "renderer", [toPersistedTimelineEvent(event)])
    )
      .catch(() => undefined)
      .finally(() => {
        pendingTimelinePersistence.delete(pending);
      });
    pendingTimelinePersistence.add(pending);
  } catch {
    // Timeline diagnostics are best-effort.
  }
}

function coerceStepKind(
  stage: "postprocessing" | "completion",
  stepName: string
): DictationTimelineKind {
  if (stage === "postprocessing") {
    return "postprocessing";
  }

  if (stepName === "insert") {
    return "insert";
  }

  if (stepName === "clipboard-history" || stepName === "db-history") {
    return "history";
  }

  return "completion";
}

function coerceStepStatus(status: string): DictationTimelineStatus {
  if (status === "completed" || status === "skipped" || status === "failed") {
    return status;
  }

  return "info";
}

function sourceFromMeta(meta: Record<string, unknown>): string | undefined {
  const source = meta.source;
  return typeof source === "string" && source.trim() ? source.trim() : undefined;
}

export function readDictationTimelineSessions(): DictationTimelineSession[] {
  return readRawSessions();
}

export async function flushDictationTimelinePersistence(): Promise<void> {
  const pending = Array.from(pendingTimelinePersistence);
  if (pending.length === 0) {
    return;
  }

  await Promise.allSettled(pending);
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergeDictationTimelineSessions(
  ...groups: Array<DictationTimelineSession[] | null | undefined>
): DictationTimelineSession[] {
  const bySession = new Map<string, DictationTimelineSession>();

  for (const group of groups) {
    for (const candidate of group || []) {
      if (!candidate?.sessionId) {
        continue;
      }

      const existing = bySession.get(candidate.sessionId);
      if (
        !existing ||
        candidate.events.length > existing.events.length ||
        (candidate.events.length === existing.events.length &&
          timestampMs(candidate.updatedAt) > timestampMs(existing.updatedAt))
      ) {
        bySession.set(candidate.sessionId, candidate);
      }
    }
  }

  return Array.from(bySession.values()).sort(
    (left, right) => timestampMs(right.updatedAt) - timestampMs(left.updatedAt)
  );
}

export function readDictationTimelineSession(
  sessionId: string | null | undefined
): DictationTimelineSession | null {
  if (!sessionId) {
    return null;
  }

  return readRawSessions().find((session) => session.sessionId === sessionId) || null;
}

export function createDictationTimelineSession(
  sessionId: string,
  source = "renderer"
): DictationTimelineSession | null {
  if (!sessionId) {
    return null;
  }

  const now = new Date().toISOString();
  const session: DictationTimelineSession = {
    sessionId,
    source,
    startedAt: now,
    updatedAt: now,
    events: [],
  };

  writeSessions(updateSessionList(session));
  return recordDictationTimelineEvent(sessionId, {
    kind: "session",
    label: "session.start",
    status: "started",
    source,
  });
}

export function recordDictationTimelineEvent(
  sessionId: string,
  event: DictationTimelineEventInput
): DictationTimelineSession | null {
  if (!sessionId) {
    return null;
  }

  const sessions = readRawSessions();
  let session = sessions.find((item) => item.sessionId === sessionId);
  if (!session) {
    const now = new Date().toISOString();
    session = {
      sessionId,
      source: event.source || "unknown",
      startedAt: now,
      updatedAt: now,
      events: [],
    };
  }

  const at = new Date().toISOString();
  const entry: DictationTimelineEvent = {
    ...event,
    id: createId(),
    sessionId,
    at,
    elapsedMs: Math.max(0, Date.now() - sessionStartedAtMs(session)),
    status: event.status || "info",
    durationMs:
      typeof event.durationMs === "number" && Number.isFinite(event.durationMs)
        ? Math.max(0, Math.round(event.durationMs))
        : undefined,
  };

  const updated: DictationTimelineSession = {
    ...session,
    source: session.source || event.source || "unknown",
    updatedAt: at,
    events: [...session.events, entry].slice(-MAX_EVENTS_PER_SESSION),
  };

  writeSessions(updateSessionList(updated));
  persistTimelineEvent(sessionId, entry);
  return updated;
}

export function recordDictationPipelineSteps(
  sessionId: string,
  stage: "postprocessing" | "completion",
  steps: PipelineStep[] | null | undefined,
  meta: Record<string, unknown> = {}
): DictationTimelineSession | null {
  if (!sessionId || !Array.isArray(steps) || steps.length === 0) {
    return readDictationTimelineSession(sessionId);
  }

  let latest: DictationTimelineSession | null = null;
  const source = sourceFromMeta(meta);
  for (const step of steps) {
    latest = recordDictationTimelineEvent(sessionId, {
      kind: coerceStepKind(stage, step.name),
      label: `${stage}.${step.name}`,
      status: coerceStepStatus(step.status),
      source,
      durationMs: step.durationMs,
      detail: step.detail,
      meta,
    });
  }

  return latest;
}
