import { platform, type RendererLogPayload } from "../shared/platform";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const normalizeLevel = (value?: string | null): LogLevel | null => {
  if (!value) return null;
  const lower = value.toLowerCase();
  return lower in LOG_LEVELS ? (lower as LogLevel) : null;
};

const defaultLevel: LogLevel = "info";

let cachedLevel: LogLevel | null = null;
let levelPromise: Promise<LogLevel> | null = null;

function compactLogKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function isSensitiveLogKey(key: string): boolean {
  const compact = compactLogKey(key);
  return (
    [
      "apikey",
      "accesstoken",
      "authtoken",
      "token",
      "secret",
      "password",
      "credential",
      "authorization",
      "keypreview",
      "tokenpreview",
      "secretpreview",
      "credentialpreview",
    ].includes(compact) ||
    compact.endsWith("apikey") ||
    compact.endsWith("accesstoken") ||
    compact.endsWith("authtoken") ||
    compact.endsWith("secret") ||
    compact.endsWith("password") ||
    compact.endsWith("credential") ||
    compact.endsWith("authorization") ||
    compact.endsWith("keypreview") ||
    compact.endsWith("tokenpreview") ||
    compact.endsWith("secretpreview") ||
    compact.endsWith("credentialpreview")
  );
}

function isTextPayloadLogKey(key: string): boolean {
  return [
    "text",
    "rawtext",
    "processedtext",
    "transcript",
    "transcription",
    "clipboardtext",
    "selectedtext",
    "prompt",
    "systemprompt",
    "userprompt",
    "content",
    "delta",
    "input",
    "output",
    "messages",
    "requestbody",
    "response",
    "responsetext",
    "fullresponse",
    "fullresult",
    "errortext",
    "textpreview",
    "resultpreview",
    "datapreview",
    "chunkpreview",
  ].includes(compactLogKey(key));
}
const SECRET_TEXT_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(sk-[A-Za-z0-9_-]{8,})/gi,
  /(xox[baprs]-[A-Za-z0-9-]{8,})/gi,
];

function redactFreeformText(value: string): string {
  return SECRET_TEXT_PATTERNS.reduce(
    (next, pattern) => next.replace(pattern, "[REDACTED_SECRET]"),
    value
  );
}

function redactValue(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    if (key && isSensitiveLogKey(key)) {
      return "[REDACTED_SECRET]";
    }
    if (key && isTextPayloadLogKey(key)) {
      return `[REDACTED_TEXT length=${value.length}]`;
    }
    return redactFreeformText(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[REDACTED_CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey, seen),
    ])
  );
}

export function redactLogPayload(payload: RendererLogPayload): RendererLogPayload {
  return {
    ...payload,
    message: redactFreeformText(String(payload.message)),
    meta: redactValue(payload.meta) as JsonLike | undefined,
  };
}

const resolveLogLevel = async (): Promise<LogLevel> => {
  if (cachedLevel) {
    return cachedLevel;
  }
  if (!levelPromise) {
    levelPromise = (async () => {
      try {
        const level = normalizeLevel(await platform.logging.getLevel());
        if (level) {
          cachedLevel = level;
          return level;
        }
      } catch {
        // Fall back to default level
      }

      cachedLevel = defaultLevel;
      return cachedLevel;
    })();
  }
  return levelPromise;
};

const shouldLog = (level: LogLevel, current: LogLevel) => {
  return LOG_LEVELS[level] >= LOG_LEVELS[current];
};

const logToConsole = (level: LogLevel, message: string, meta?: any, scope?: string) => {
  const levelTag = `[${level.toUpperCase()}]`;
  const scopeTag = scope ? `[${scope}]` : "";
  const consoleFn =
    level === "error" || level === "fatal"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  if (meta !== undefined) {
    consoleFn(`${levelTag}${scopeTag} ${message}`, meta);
  } else {
    consoleFn(`${levelTag}${scopeTag} ${message}`);
  }
};

const log = async (level: LogLevel, message: string, meta?: any, scope?: string) => {
  const currentLevel = await resolveLogLevel();
  if (!shouldLog(level, currentLevel)) return;

  const payload = redactLogPayload({
    level,
    message: String(message),
    meta,
    scope,
    source: "renderer",
  });

  try {
    await platform.logging.write(payload);
    return;
  } catch {
    // Fall back to console
  }

  logToConsole(level, payload.message, payload.meta, scope);
};

const logger = {
  trace: (message: string, meta?: any, scope?: string) => log("trace", message, meta, scope),
  debug: (message: string, meta?: any, scope?: string) => log("debug", message, meta, scope),
  info: (message: string, meta?: any, scope?: string) => log("info", message, meta, scope),
  warn: (message: string, meta?: any, scope?: string) => log("warn", message, meta, scope),
  error: (message: string, meta?: any, scope?: string) => log("error", message, meta, scope),
  fatal: (message: string, meta?: any, scope?: string) => log("fatal", message, meta, scope),
  logReasoning: (stage: string, details?: any) => log("debug", stage, details, "reasoning"),
  refreshLogLevel: () => {
    cachedLevel = null;
    levelPromise = null;
  },
};

export default logger;
