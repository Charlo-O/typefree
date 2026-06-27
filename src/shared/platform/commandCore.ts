import type {
  CommandResult,
  DebugLoggingResult,
  DebugState,
  UpdateCheckResult,
  UpdateInfoResult,
  UpdateStatusResult,
} from "./types";

export type {
  CommandResult,
  DebugLoggingResult,
  DebugState,
  UpdateCheckResult,
  UpdateInfoResult,
  UpdateStatusResult,
};

export type ClearTranscriptionsResult = CommandResult & {
  cleared?: number;
};

export const unavailableInTauriBuild = (feature: string) =>
  `${feature} is not available in this Tauri build`;

export type CommandErrorKind =
  | "permission"
  | "network"
  | "configuration"
  | "cancelled"
  | "timeout"
  | "provider"
  | "clipboard"
  | "internal";

export type CommandErrorPayload = {
  kind: CommandErrorKind;
  message: string;
  retryable: boolean;
  source?: string | null;
};

export class TauriCommandError extends Error {
  kind: CommandErrorKind;
  retryable: boolean;
  source?: string | null;

  constructor(payload: CommandErrorPayload) {
    super(payload.message);
    this.name = "TauriCommandError";
    this.kind = payload.kind;
    this.retryable = payload.retryable;
    this.source = payload.source ?? null;
  }
}

function isCommandErrorPayload(value: unknown): value is CommandErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).kind === "string" &&
    typeof (value as any).message === "string"
  );
}

export function normalizeCommandError(error: unknown): TauriCommandError {
  if (isCommandErrorPayload(error)) {
    return new TauriCommandError({
      kind: error.kind,
      message: error.message,
      retryable: Boolean(error.retryable),
      source: error.source ?? null,
    });
  }

  if (error instanceof TauriCommandError) {
    return error;
  }

  if (error instanceof Error) {
    const candidate = error as Error & Partial<CommandErrorPayload>;
    if (candidate.kind && candidate.message) {
      return new TauriCommandError({
        kind: candidate.kind,
        message: candidate.message,
        retryable: Boolean(candidate.retryable),
        source: candidate.source ?? null,
      });
    }

    return new TauriCommandError({
      kind: "internal",
      message: error.message,
      retryable: false,
    });
  }

  return new TauriCommandError({
    kind: "internal",
    message: String(error),
    retryable: false,
  });
}

export const getErrorMessage = (error: unknown): string => normalizeCommandError(error).message;

export function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const w = window as any;
  if (typeof w.__TAURI_INTERNALS__ !== "undefined") {
    return true;
  }
  if (typeof w.__TAURI__ !== "undefined") {
    return true;
  }

  return false;
}
