import { useCallback, useState, useEffect, useRef } from "react";
import { Button } from "../../../components/ui/button";
import {
  FolderOpen,
  Info,
  Wrench,
  Copy,
  Check,
  AlertCircle,
  FileText,
  Activity,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "../../../components/ui/toast-context";
import { useI18n } from "../../../i18n";
import {
  platform,
  type ForegroundApplication,
  type NativeRecordingCapabilities,
  type PersistedDictationTimelineSession,
  type PrivacyDiagnostics,
} from "../../../shared/platform";
import {
  createDictationCompletionGuard,
  runDictationCompletionPipeline,
} from "../../dictation/pipeline/completionPipeline";
import {
  createDictationTimelineSession,
  flushDictationTimelinePersistence,
  mergeDictationTimelineSessions,
  readDictationTimelineSessions,
  recordDictationPipelineSteps,
  recordDictationTimelineEvent,
  type DictationTimelineEvent,
  type DictationTimelineSession,
} from "../../dictation/timeline/sessionTimeline";
import { loadVocabularySettings, syncVocabularySettingsToBackend } from "../../../utils/vocabulary";

const MAX_VISIBLE_SESSIONS = 5;
const MAX_VISIBLE_EVENTS = 16;

function normalizePersistedTimelineSessions(
  sessions: PersistedDictationTimelineSession[]
): DictationTimelineSession[] {
  return sessions.map((session) => ({
    ...session,
    events: session.events.map((event) => ({
      ...event,
      phase: event.phase || undefined,
      source: event.source || undefined,
      durationMs: event.durationMs ?? undefined,
      detail: event.detail || undefined,
      meta: event.meta || undefined,
    })),
  }));
}

type RuntimeProbeStatus = "passed" | "warning" | "failed";

type RuntimeProbeCheck = {
  id: string;
  label: string;
  status: RuntimeProbeStatus;
  detail: string;
  meta?: Record<string, unknown>;
};

const RUNTIME_PROBE_AUTORUN_ENV = "VITE_TYPEFREE_RUNTIME_PROBE_AUTORUN";
const RUNTIME_PROBE_SENTINEL = "TYPEFREE_RUNTIME_PROBE_RESULT";
const NATIVE_RECORDING_SMOKE_AUTORUN_ENV = "VITE_TYPEFREE_NATIVE_RECORDING_SMOKE_AUTORUN";
const NATIVE_RECORDING_SMOKE_SENTINEL = "TYPEFREE_NATIVE_RECORDING_SMOKE_RESULT";
const DICTATION_PIPELINE_SMOKE_AUTORUN_ENV = "VITE_TYPEFREE_DICTATION_PIPELINE_SMOKE_AUTORUN";
const DICTATION_PIPELINE_SMOKE_SENTINEL = "TYPEFREE_DICTATION_PIPELINE_SMOKE_RESULT";
const CLOUD_TRANSCRIPTION_SMOKE_AUTORUN_ENV = "VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_AUTORUN";
const CLOUD_TRANSCRIPTION_SMOKE_SENTINEL = "TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_RESULT";
const CLOUD_CREDENTIAL_PREFLIGHT_AUTORUN_ENV = "VITE_TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_AUTORUN";
const CLOUD_CREDENTIAL_PREFLIGHT_SENTINEL = "TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_RESULT";
const DEFAULT_NATIVE_RECORDING_SMOKE_MS = 900;
const DEFAULT_CLOUD_TRANSCRIPTION_SMOKE_MS = 3500;

type RuntimeProbeResult = {
  sessionId: string;
  status: RuntimeProbeStatus;
  failed: number;
  warnings: number;
  checks: Array<{
    id: string;
    status: RuntimeProbeStatus;
    detail: string;
    meta?: Record<string, unknown>;
  }>;
};

function runtimeProbeStatus(checks: RuntimeProbeCheck[]): RuntimeProbeStatus {
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "passed";
}

function createRuntimeProbeResult(
  sessionId: string,
  checks: RuntimeProbeCheck[]
): RuntimeProbeResult {
  return {
    sessionId,
    status: runtimeProbeStatus(checks),
    failed: checks.filter((check) => check.status === "failed").length,
    warnings: checks.filter((check) => check.status === "warning").length,
    checks: checks.map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail,
      meta: check.meta,
    })),
  };
}

function shouldAutorunRuntimeProbe(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return import.meta.env[RUNTIME_PROBE_AUTORUN_ENV] === "1" || params.has("runtimeProbe");
  } catch {
    return false;
  }
}

function shouldAutorunNativeRecordingSmoke(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      import.meta.env[NATIVE_RECORDING_SMOKE_AUTORUN_ENV] === "1" ||
      params.has("nativeRecordingSmoke")
    );
  } catch {
    return false;
  }
}

function shouldAutorunDictationPipelineSmoke(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      import.meta.env[DICTATION_PIPELINE_SMOKE_AUTORUN_ENV] === "1" ||
      params.has("dictationPipelineSmoke")
    );
  } catch {
    return false;
  }
}

function shouldAutorunCloudTranscriptionSmoke(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      import.meta.env[CLOUD_TRANSCRIPTION_SMOKE_AUTORUN_ENV] === "1" ||
      params.has("cloudTranscriptionSmoke")
    );
  } catch {
    return false;
  }
}

function shouldAutorunCloudCredentialPreflight(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      import.meta.env[CLOUD_CREDENTIAL_PREFLIGHT_AUTORUN_ENV] === "1" ||
      params.has("cloudCredentialPreflight")
    );
  } catch {
    return false;
  }
}

function nativeRecordingSmokeDurationMs(): number {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw =
      params.get("nativeRecordingSmokeMs") ||
      import.meta.env.VITE_TYPEFREE_NATIVE_RECORDING_SMOKE_MS ||
      "";
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_NATIVE_RECORDING_SMOKE_MS;
    return Math.min(5000, Math.max(300, parsed));
  } catch {
    return DEFAULT_NATIVE_RECORDING_SMOKE_MS;
  }
}

function cloudTranscriptionSmokeDurationMs(): number {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw =
      params.get("cloudTranscriptionSmokeMs") ||
      import.meta.env.VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_MS ||
      "";
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_CLOUD_TRANSCRIPTION_SMOKE_MS;
    return Math.min(15000, Math.max(1000, parsed));
  } catch {
    return DEFAULT_CLOUD_TRANSCRIPTION_SMOKE_MS;
  }
}

function cloudTranscriptionSmokeOption(
  queryName: string,
  envName: "PROVIDER" | "MODEL" | "LANGUAGE",
  fallback = ""
): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get(queryName) ||
      import.meta.env[`VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_${envName}`] ||
      fallback
    ).trim();
  } catch {
    return fallback;
  }
}

function cloudTranscriptionFixturePath(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("cloudTranscriptionFixturePath") ||
      import.meta.env.VITE_TYPEFREE_CLOUD_TRANSCRIPTION_FIXTURE_PATH ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

function cloudTranscriptionPlaybackPath(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("cloudTranscriptionPlaybackPath") ||
      import.meta.env.VITE_TYPEFREE_CLOUD_TRANSCRIPTION_PLAYBACK_PATH ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

function credentialKeysForCloudTranscriptionProvider(provider: string): string[] {
  switch (provider.trim().toLowerCase()) {
    case "assemblyai":
      return ["ASSEMBLYAI_API_KEY"];
    case "openai":
      return ["OPENAI_API_KEY"];
    case "groq":
      return ["GROQ_API_KEY"];
    case "zai":
      return ["ZAI_API_KEY"];
    case "volcengine":
      return ["VOLCENGINE_APP_ID", "VOLCENGINE_ACCESS_TOKEN"];
    default:
      return [];
  }
}

function waitForSmokeDuration(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

function isWavAudioData(audioData?: Uint8Array | null): boolean {
  if (!audioData || audioData.byteLength < 44) {
    return false;
  }

  return (
    audioData[0] === 0x52 &&
    audioData[1] === 0x49 &&
    audioData[2] === 0x46 &&
    audioData[3] === 0x46 &&
    audioData[8] === 0x57 &&
    audioData[9] === 0x41 &&
    audioData[10] === 0x56 &&
    audioData[11] === 0x45
  );
}

function viteFsUrlForLocalPath(localPath: string): string {
  if (/^https?:\/\//i.test(localPath) || localPath.startsWith("/@fs/")) {
    return localPath;
  }

  return `/@fs/${localPath.replace(/\\/g, "/")}`;
}

async function loadCloudTranscriptionFixtureAudio(localPath: string): Promise<Uint8Array> {
  const response = await fetch(viteFsUrlForLocalPath(localPath));
  if (!response.ok) {
    throw new Error(`Failed to load cloud transcription fixture: ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function playCloudTranscriptionPlaybackAudio(localPath: string): Promise<{
  audioBytes: number;
  audio: HTMLAudioElement;
  cleanup: () => void;
  wav: boolean;
}> {
  const audioData = await loadCloudTranscriptionFixtureAudio(localPath);
  const wav = isWavAudioData(audioData);
  if (audioData.byteLength < 44 || !wav) {
    throw new Error("Cloud transcription playback fixture did not contain valid WAV audio");
  }

  const audioBuffer = new ArrayBuffer(audioData.byteLength);
  new Uint8Array(audioBuffer).set(audioData);
  const objectUrl = URL.createObjectURL(new Blob([audioBuffer], { type: "audio/wav" }));
  const audio = new Audio(objectUrl);
  audio.volume = 1;
  audio.preload = "auto";
  await audio.play();

  return {
    audioBytes: audioData.byteLength,
    audio,
    cleanup: () => {
      audio.pause();
      URL.revokeObjectURL(objectUrl);
    },
    wav,
  };
}

async function emitRuntimeProbeResult(result: RuntimeProbeResult): Promise<void> {
  const summary = {
    sessionId: result.sessionId,
    status: result.status,
    failed: result.failed,
    warnings: result.warnings,
  };

  try {
    await platform.logging.write({
      level: result.status === "failed" ? "error" : "info",
      scope: "runtime-probe",
      source: "renderer",
      message: `${RUNTIME_PROBE_SENTINEL} ${JSON.stringify(summary)}`,
      meta: result,
    });
  } catch (error) {
    console.warn("Failed to emit runtime probe result:", error);
  }
}

async function emitNativeRecordingSmokeResult(result: RuntimeProbeResult): Promise<void> {
  const summary = {
    sessionId: result.sessionId,
    status: result.status,
    failed: result.failed,
    warnings: result.warnings,
  };

  try {
    await platform.logging.write({
      level: result.status === "failed" ? "error" : "info",
      scope: "native-recording-smoke",
      source: "renderer",
      message: `${NATIVE_RECORDING_SMOKE_SENTINEL} ${JSON.stringify(summary)}`,
      meta: result,
    });
  } catch (error) {
    console.warn("Failed to emit native recording smoke result:", error);
  }
}

async function emitDictationPipelineSmokeResult(result: RuntimeProbeResult): Promise<void> {
  const summary = {
    sessionId: result.sessionId,
    status: result.status,
    failed: result.failed,
    warnings: result.warnings,
  };

  try {
    await platform.logging.write({
      level: result.status === "failed" ? "error" : "info",
      scope: "dictation-pipeline-smoke",
      source: "renderer",
      message: `${DICTATION_PIPELINE_SMOKE_SENTINEL} ${JSON.stringify(summary)}`,
      meta: result,
    });
  } catch (error) {
    console.warn("Failed to emit dictation pipeline smoke result:", error);
  }
}

async function emitCloudTranscriptionSmokeResult(result: RuntimeProbeResult): Promise<void> {
  const summary = {
    sessionId: result.sessionId,
    status: result.status,
    failed: result.failed,
    warnings: result.warnings,
  };

  try {
    await platform.logging.write({
      level: result.status === "failed" ? "error" : "info",
      scope: "cloud-transcription-smoke",
      source: "renderer",
      message: `${CLOUD_TRANSCRIPTION_SMOKE_SENTINEL} ${JSON.stringify(summary)}`,
      meta: result,
    });
  } catch (error) {
    console.warn("Failed to emit cloud transcription smoke result:", error);
  }
}

async function emitCloudCredentialPreflightResult(result: RuntimeProbeResult): Promise<void> {
  const summary = {
    sessionId: result.sessionId,
    status: result.status,
    failed: result.failed,
    warnings: result.warnings,
  };

  try {
    await platform.logging.write({
      level: result.status === "failed" ? "error" : "info",
      scope: "cloud-credential-preflight",
      source: "renderer",
      message: `${CLOUD_CREDENTIAL_PREFLIGHT_SENTINEL} ${JSON.stringify(summary)}`,
      meta: result,
    });
  } catch (error) {
    console.warn("Failed to emit cloud credential preflight result:", error);
  }
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`;
  }

  return `${Math.round(value)}ms`;
}

function formatNativeRecordingMeta(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const nativeRecording = value as Record<string, unknown>;
  const backend = typeof nativeRecording.backend === "string" ? nativeRecording.backend : "";
  const platform = typeof nativeRecording.platform === "string" ? nativeRecording.platform : "";
  const recorderStatus =
    typeof nativeRecording.recorderStatus === "string" ? nativeRecording.recorderStatus : "";
  const reason = typeof nativeRecording.reason === "string" ? nativeRecording.reason : "";
  const supported = nativeRecording.supported === true;
  const active = nativeRecording.active === true;
  const parts: string[] = [];

  if (backend || platform) {
    parts.push(`native ${[backend, platform].filter(Boolean).join("@")}`);
  }
  if (recorderStatus) {
    parts.push(`status ${recorderStatus}`);
  }
  if (active) {
    parts.push("active");
  }
  if (!supported) {
    parts.push("fallback");
  }
  if (reason) {
    parts.push(reason);
  }

  return parts.join(" ");
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta) {
    return "";
  }

  const parts: string[] = [];
  const outputTextLength = meta.outputTextLength;
  const reasoningDuration = meta.reasoningProcessingDurationMs;
  const processingMode = meta.processingMode;
  const nativeRecording = formatNativeRecordingMeta(meta.nativeRecording);

  if (typeof outputTextLength === "number") {
    parts.push(`len ${outputTextLength}`);
  }
  if (typeof reasoningDuration === "number") {
    parts.push(`reasoning ${formatDuration(reasoningDuration)}`);
  }
  if (typeof processingMode === "string" && processingMode) {
    parts.push(processingMode);
  }
  if (nativeRecording) {
    parts.push(nativeRecording);
  }

  return parts.join(" | ");
}

function statusClass(status: DictationTimelineEvent["status"]): string {
  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "skipped" || status === "cancelled") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "started") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

function probeStatusClass(status: RuntimeProbeStatus): string {
  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (status === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function formatApplication(application?: ForegroundApplication | null): string {
  if (!application) {
    return "";
  }

  const primary = application.name || application.id;
  const secondary = application.bundleId || application.executablePath || application.id;

  if (!secondary || secondary === primary) {
    return primary;
  }

  return `${primary} (${secondary})`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || "Unknown error";
  }

  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }

  return String(error || "Unknown error");
}

function formatErrorMeta(error: unknown): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    errorMessage: formatError(error),
  };

  if (error instanceof Error) {
    meta.errorName = error.name;
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      kind?: unknown;
      source?: unknown;
      retryable?: unknown;
      name?: unknown;
    };
    if (typeof candidate.kind === "string") {
      meta.errorKind = candidate.kind;
    }
    if (typeof candidate.source === "string") {
      meta.errorSource = candidate.source;
    }
    if (typeof candidate.retryable === "boolean") {
      meta.retryable = candidate.retryable;
    }
    if (!meta.errorName && typeof candidate.name === "string") {
      meta.errorName = candidate.name;
    }
  }

  return meta;
}

function nativeRecordingProbeStatus(capabilities: NativeRecordingCapabilities): RuntimeProbeStatus {
  if (capabilities.active) {
    return "warning";
  }

  return capabilities.supported ? "passed" : "warning";
}

function formatRuntimeProbeTimelineDetail(checks: RuntimeProbeCheck[]): string {
  return checks
    .map((check) =>
      check.id === "native-recording"
        ? `${check.id}:${check.status}:${check.detail}`
        : `${check.id}:${check.status}`
    )
    .join(", ");
}

function createRuntimeProbeTimelineMeta(checks: RuntimeProbeCheck[]): Record<string, unknown> {
  const nativeRecording = checks.find((check) => check.id === "native-recording");

  return {
    checks: checks.map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail,
      meta: check.meta || null,
    })),
    nativeRecording: nativeRecording
      ? {
          ...(nativeRecording.meta || {}),
          status: nativeRecording.status,
          detail: nativeRecording.detail,
        }
      : null,
  };
}

function DecisionPill({
  active,
  activeText,
  inactiveText,
}: {
  active: boolean;
  activeText: string;
  inactiveText: string;
}) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
        active
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {active ? activeText : inactiveText}
    </span>
  );
}

function ProbeRow({ check }: { check: RuntimeProbeCheck }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-t border-neutral-100 py-2 text-sm first:border-t-0">
      <div className="min-w-0">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${probeStatusClass(
            check.status
          )}`}
        >
          {check.status}
        </span>
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-neutral-900">{check.label}</div>
        <div className="mt-1 break-all font-mono text-xs text-neutral-500">{check.detail}</div>
      </div>
    </div>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-t border-neutral-100 py-2 text-sm first:border-t-0">
      <div className="text-xs font-medium uppercase text-neutral-500">{label}</div>
      <div className="min-w-0 break-all font-mono text-xs text-neutral-800">{value}</div>
    </div>
  );
}

function TimelineEventRow({ event }: { event: DictationTimelineEvent }) {
  const duration = formatDuration(event.durationMs);
  const meta = formatMeta(event.meta);

  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-3 border-t border-neutral-100 py-2 first:border-t-0">
      <div className="text-right font-mono text-[11px] leading-5 text-neutral-500">
        +{event.elapsedMs}ms
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${statusClass(
              event.status
            )}`}
          >
            {event.status}
          </span>
          <span className="truncate font-mono text-xs text-neutral-900">{event.label}</span>
          {duration && <span className="font-mono text-[11px] text-neutral-500">{duration}</span>}
        </div>
        {(event.detail || meta) && (
          <div className="mt-1 truncate text-xs text-neutral-500">
            {[event.detail, meta].filter(Boolean).join(" | ")}
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineSessionCard({ session }: { session: DictationTimelineSession }) {
  const events = session.events.slice(-MAX_VISIBLE_EVENTS);
  const failedCount = session.events.filter((event) => event.status === "failed").length;
  const lastEvent = session.events.at(-1);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white">
              {session.source || "unknown"}
            </span>
            {lastEvent && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${statusClass(
                  lastEvent.status
                )}`}
              >
                {lastEvent.status}
              </span>
            )}
          </div>
          <div className="mt-2 truncate font-mono text-xs text-neutral-600">
            {session.sessionId}
          </div>
        </div>
        <div className="text-right text-xs text-neutral-500">
          <div>{formatClock(session.updatedAt)}</div>
          <div>
            {session.events.length} events{failedCount ? ` | ${failedCount} failed` : ""}
          </div>
        </div>
      </div>
      <div className="px-4 py-1">
        {events.map((event) => (
          <TimelineEventRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

export default function DeveloperSection() {
  const { t } = useI18n();
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [timelineSessions, setTimelineSessions] = useState<DictationTimelineSession[]>([]);
  const [isTimelineRefreshing, setIsTimelineRefreshing] = useState(false);
  const [privacyDiagnostics, setPrivacyDiagnostics] = useState<PrivacyDiagnostics | null>(null);
  const [isPrivacyRefreshing, setIsPrivacyRefreshing] = useState(false);
  const [runtimeProbeChecks, setRuntimeProbeChecks] = useState<RuntimeProbeCheck[]>([]);
  const [isRuntimeProbeRunning, setIsRuntimeProbeRunning] = useState(false);
  const [isNativeRecordingSmokeRunning, setIsNativeRecordingSmokeRunning] = useState(false);
  const [isDictationPipelineSmokeRunning, setIsDictationPipelineSmokeRunning] = useState(false);
  const [isCloudTranscriptionSmokeRunning, setIsCloudTranscriptionSmokeRunning] = useState(false);
  const [isCloudCredentialPreflightRunning, setIsCloudCredentialPreflightRunning] = useState(false);
  const runtimeProbeAutorunRef = useRef(false);
  const nativeRecordingSmokeAutorunRef = useRef(false);
  const dictationPipelineSmokeAutorunRef = useRef(false);
  const cloudTranscriptionSmokeAutorunRef = useRef(false);
  const cloudCredentialPreflightAutorunRef = useRef(false);
  const { toast } = useToast();

  const loadDebugState = useCallback(async () => {
    try {
      setIsLoading(true);
      const state = await platform.debug.getState();
      setDebugEnabled(state.enabled);
      setLogPath(state.logPath);
    } catch (error) {
      console.error("Failed to load debug state:", error);
      toast({
        title: "Error loading debug state",
        description: "Could not retrieve debug logging status",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const loadTimelineSessions = useCallback(async () => {
    const localSessions = readDictationTimelineSessions();
    let persistedSessions: DictationTimelineSession[] = [];

    try {
      const persisted = await platform.history.getDictationTimelineSessions(MAX_VISIBLE_SESSIONS);
      persistedSessions = normalizePersistedTimelineSessions(persisted);
    } catch (error) {
      console.warn("Failed to load persisted dictation timeline:", error);
    }

    setTimelineSessions(
      mergeDictationTimelineSessions(localSessions, persistedSessions).slice(
        0,
        MAX_VISIBLE_SESSIONS
      )
    );
  }, []);

  const loadPrivacyDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await platform.debug.getPrivacyDiagnostics();
      setPrivacyDiagnostics(diagnostics);
    } catch (error) {
      console.error("Failed to load privacy diagnostics:", error);
      toast({
        title: "Error loading privacy diagnostics",
        description: "Could not retrieve privacy decision state",
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    void loadDebugState();
    void loadTimelineSessions();
    void loadPrivacyDiagnostics();
  }, [loadDebugState, loadTimelineSessions, loadPrivacyDiagnostics]);

  useEffect(() => {
    const refresh = () => {
      void loadTimelineSessions();
    };
    const intervalId = window.setInterval(refresh, 2500);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [loadTimelineSessions]);

  const handleRefreshTimeline = async () => {
    setIsTimelineRefreshing(true);
    await loadTimelineSessions();
    window.setTimeout(() => setIsTimelineRefreshing(false), 180);
  };

  const handleRefreshPrivacyDiagnostics = async () => {
    setIsPrivacyRefreshing(true);
    await loadPrivacyDiagnostics();
    window.setTimeout(() => setIsPrivacyRefreshing(false), 180);
  };

  const handleRunRuntimeProbe = useCallback(async () => {
    if (isRuntimeProbeRunning) return;

    const probeSessionId = `developer-smoke-${Date.now()}`;
    const checks: RuntimeProbeCheck[] = [];
    const addCheck = (check: RuntimeProbeCheck) => {
      checks.push(check);
      setRuntimeProbeChecks([...checks]);
    };
    const noneText = t("developer.privacy.none");
    const unknownText = t("developer.runtimeProbe.unknown");

    setIsRuntimeProbeRunning(true);
    setRuntimeProbeChecks([]);

    let foregroundApplication: ForegroundApplication | null = null;

    try {
      createDictationTimelineSession(probeSessionId, "developer-smoke");
      const isTauri = platform.runtime.isTauri();
      let platformName = "";
      try {
        platformName = await platform.runtime.getPlatform();
      } catch {
        platformName = "";
      }

      addCheck({
        id: "runtime",
        label: t("developer.runtimeProbe.runtime"),
        status: isTauri ? "passed" : "warning",
        detail: isTauri
          ? t("developer.runtimeProbe.platform", { platform: platformName || unknownText })
          : t("developer.runtimeProbe.browser"),
      });

      try {
        const capabilities = await platform.recording.getNativeCapabilities();
        const backend = capabilities.backend || unknownText;
        const recorderPlatform = capabilities.platform || platformName || unknownText;
        const status = capabilities.status || unknownText;
        const reason = capabilities.reason || null;
        const nativeRecordingMeta = {
          backend,
          platform: recorderPlatform,
          recorderStatus: status,
          reason,
          supported: capabilities.supported,
          active: capabilities.active,
        };

        addCheck({
          id: "native-recording",
          label: t("developer.runtimeProbe.nativeRecording"),
          status: nativeRecordingProbeStatus(capabilities),
          detail: capabilities.supported
            ? capabilities.active
              ? t("developer.runtimeProbe.nativeRecordingActive", {
                  backend,
                  platform: recorderPlatform,
                })
              : t("developer.runtimeProbe.nativeRecordingReady", {
                  backend,
                  platform: recorderPlatform,
                  status,
                })
            : t("developer.runtimeProbe.nativeRecordingFallback", {
                backend,
                platform: recorderPlatform,
                status,
                reason: reason || unknownText,
              }),
          meta: nativeRecordingMeta,
        });
      } catch (error) {
        const detail = formatError(error);
        addCheck({
          id: "native-recording",
          label: t("developer.runtimeProbe.nativeRecording"),
          status: "failed",
          detail,
          meta: { error: detail },
        });
      }

      try {
        await syncVocabularySettingsToBackend();
        addCheck({
          id: "vocabulary-settings",
          label: t("developer.runtimeProbe.vocabulary"),
          status: "passed",
          detail: t("developer.runtimeProbe.settingsSynced"),
        });
      } catch (error) {
        addCheck({
          id: "vocabulary-settings",
          label: t("developer.runtimeProbe.vocabulary"),
          status: "failed",
          detail: formatError(error),
        });
      }

      try {
        foregroundApplication = await platform.app.syncForegroundApplicationVocabulary();
        addCheck({
          id: "foreground",
          label: t("developer.runtimeProbe.foreground"),
          status: foregroundApplication?.id ? "passed" : "warning",
          detail: foregroundApplication
            ? formatApplication(foregroundApplication) || foregroundApplication.id
            : t("developer.runtimeProbe.foregroundNone"),
        });
      } catch (error) {
        foregroundApplication = null;
        addCheck({
          id: "foreground",
          label: t("developer.runtimeProbe.foreground"),
          status: "failed",
          detail: formatError(error),
        });
      }

      try {
        const vocabularySettings = await loadVocabularySettings();
        const actualActiveApplicationId = vocabularySettings.layers.activeApplicationId || null;
        const expectedActiveApplicationId = foregroundApplication?.id || null;
        const matchesForeground = actualActiveApplicationId === expectedActiveApplicationId;

        addCheck({
          id: "vocabulary",
          label: t("developer.runtimeProbe.vocabulary"),
          status: matchesForeground ? "passed" : "failed",
          detail: matchesForeground
            ? t("developer.runtimeProbe.activeApplication", {
                id: actualActiveApplicationId || noneText,
              })
            : t("developer.runtimeProbe.activeApplicationMismatch", {
                actual: actualActiveApplicationId || noneText,
                expected: expectedActiveApplicationId || noneText,
              }),
        });
      } catch (error) {
        addCheck({
          id: "vocabulary",
          label: t("developer.runtimeProbe.vocabulary"),
          status: "failed",
          detail: formatError(error),
        });
      }

      try {
        const diagnostics = await platform.debug.getPrivacyDiagnostics();
        setPrivacyDiagnostics(diagnostics);
        const actualActiveForegroundId = diagnostics.activeForeground?.id || null;
        const expectedActiveForegroundId = foregroundApplication?.id || null;
        const matchesForeground = actualActiveForegroundId === expectedActiveForegroundId;

        addCheck({
          id: "privacy",
          label: t("developer.runtimeProbe.privacy"),
          status: matchesForeground ? "passed" : "failed",
          detail: matchesForeground
            ? t("developer.runtimeProbe.activeApplication", {
                id: actualActiveForegroundId || noneText,
              })
            : t("developer.runtimeProbe.activeApplicationMismatch", {
                actual: actualActiveForegroundId || noneText,
                expected: expectedActiveForegroundId || noneText,
              }),
        });
      } catch (error) {
        addCheck({
          id: "privacy",
          label: t("developer.runtimeProbe.privacy"),
          status: "failed",
          detail: formatError(error),
        });
      }

      await loadTimelineSessions();
      recordDictationTimelineEvent(probeSessionId, {
        kind: "backend",
        label: "runtime.probe",
        status: checks.some((check) => check.status === "failed") ? "failed" : "completed",
        source: "developer-smoke",
        detail: formatRuntimeProbeTimelineDetail(checks),
        meta: createRuntimeProbeTimelineMeta(checks),
      });
      await flushDictationTimelinePersistence();
      await loadTimelineSessions();
      await emitRuntimeProbeResult(createRuntimeProbeResult(probeSessionId, checks));
    } catch (error) {
      addCheck({
        id: "runtime-probe",
        label: t("developer.runtimeProbe.title"),
        status: "failed",
        detail: formatError(error),
      });
      recordDictationTimelineEvent(probeSessionId, {
        kind: "error",
        label: "runtime.probe",
        status: "failed",
        source: "developer-smoke",
        detail: formatError(error),
      });
      await flushDictationTimelinePersistence();
      await loadTimelineSessions();
      await emitRuntimeProbeResult(createRuntimeProbeResult(probeSessionId, checks));
    } finally {
      setIsRuntimeProbeRunning(false);
    }
  }, [isRuntimeProbeRunning, loadTimelineSessions, t]);

  const handleRunNativeRecordingSmoke = useCallback(async () => {
    if (isNativeRecordingSmokeRunning) return;

    const smokeSessionId = `native-recording-smoke-${Date.now()}`;
    const checks: RuntimeProbeCheck[] = [];
    const addCheck = (check: RuntimeProbeCheck) => {
      checks.push(check);
      setRuntimeProbeChecks([...checks]);
    };
    const smokeDurationMs = nativeRecordingSmokeDurationMs();
    const unknownText = t("developer.runtimeProbe.unknown");
    let nativeRecordingStarted = false;

    setIsNativeRecordingSmokeRunning(true);
    setRuntimeProbeChecks([]);

    try {
      createDictationTimelineSession(smokeSessionId, "native-recording-smoke");
      const capabilities = await platform.recording.getNativeCapabilities();
      const backend = capabilities.backend || unknownText;
      const recorderPlatform = capabilities.platform || unknownText;
      const recorderStatus = capabilities.status || unknownText;
      const capabilitiesReady = capabilities.supported && !capabilities.active;

      addCheck({
        id: "native-recording-capabilities",
        label: t("developer.runtimeProbe.nativeRecording"),
        status: capabilitiesReady ? "passed" : "warning",
        detail: capabilitiesReady
          ? `${backend}@${recorderPlatform} ${recorderStatus}`
          : capabilities.active
            ? "Native recorder is already active"
            : capabilities.reason || "Native recorder is not supported",
        meta: {
          backend,
          platform: recorderPlatform,
          recorderStatus,
          reason: capabilities.reason || null,
          supported: capabilities.supported,
          active: capabilities.active,
        },
      });

      if (capabilitiesReady) {
        try {
          const started = await platform.recording.startNative();
          nativeRecordingStarted = started === true;
          addCheck({
            id: "native-recording-start",
            label: t("developer.runtimeProbe.nativeRecording"),
            status: nativeRecordingStarted ? "passed" : "warning",
            detail: nativeRecordingStarted
              ? `Started native recording for ${smokeDurationMs}ms`
              : "Native recorder did not report a successful start",
          });
        } catch (startError) {
          addCheck({
            id: "native-recording-start",
            label: t("developer.runtimeProbe.nativeRecording"),
            status: "warning",
            detail: formatError(startError),
          });
        }

        if (nativeRecordingStarted) {
          try {
            const activeCapabilities = await platform.recording.getNativeCapabilities();
            addCheck({
              id: "native-recording-active",
              label: t("developer.runtimeProbe.nativeRecording"),
              status: activeCapabilities.active ? "passed" : "warning",
              detail: activeCapabilities.active
                ? "Native recorder reported active"
                : "Native recorder did not report active before stop",
              meta: {
                active: activeCapabilities.active,
                backend: activeCapabilities.backend,
                platform: activeCapabilities.platform,
                recorderStatus: activeCapabilities.status,
              },
            });
          } catch (activeError) {
            addCheck({
              id: "native-recording-active",
              label: t("developer.runtimeProbe.nativeRecording"),
              status: "warning",
              detail: formatError(activeError),
            });
          }

          await waitForSmokeDuration(smokeDurationMs);
          const result = await platform.recording.stopNative();
          nativeRecordingStarted = false;
          const audioBytes = result?.audioData?.byteLength || 0;
          const mimeType = result?.mimeType || "";
          const durationSeconds = result?.durationSeconds ?? null;
          const wav = isWavAudioData(result?.audioData || null);
          const validCapture = audioBytes >= 44 && wav;

          addCheck({
            id: "native-recording-capture",
            label: t("developer.runtimeProbe.nativeRecording"),
            status: validCapture ? "passed" : "failed",
            detail: `Captured ${audioBytes} bytes as ${mimeType || "unknown"}${
              durationSeconds ? ` in ${durationSeconds.toFixed(2)}s` : ""
            }`,
            meta: {
              audioBytes,
              mimeType,
              durationSeconds,
              wav,
              smokeDurationMs,
            },
          });
        }
      }
    } catch (error) {
      addCheck({
        id: "native-recording-smoke",
        label: t("developer.runtimeProbe.nativeRecording"),
        status: "failed",
        detail: formatError(error),
      });
    } finally {
      if (nativeRecordingStarted) {
        try {
          await platform.recording.cancelNative();
          addCheck({
            id: "native-recording-cancel",
            label: t("developer.runtimeProbe.nativeRecording"),
            status: "warning",
            detail: "Cancelled native recorder after smoke failure",
          });
        } catch (cancelError) {
          addCheck({
            id: "native-recording-cancel",
            label: t("developer.runtimeProbe.nativeRecording"),
            status: "failed",
            detail: formatError(cancelError),
          });
        }
      }

      recordDictationTimelineEvent(smokeSessionId, {
        kind: "backend",
        label: "native-recording.smoke",
        status: checks.some((check) => check.status === "failed") ? "failed" : "completed",
        source: "native-recording-smoke",
        detail: formatRuntimeProbeTimelineDetail(checks),
        meta: createRuntimeProbeTimelineMeta(checks),
      });
      await flushDictationTimelinePersistence();
      await loadTimelineSessions();
      await emitNativeRecordingSmokeResult(createRuntimeProbeResult(smokeSessionId, checks));
      setIsNativeRecordingSmokeRunning(false);
    }
  }, [isNativeRecordingSmokeRunning, loadTimelineSessions, t]);

  const handleRunDictationPipelineSmoke = useCallback(async () => {
    if (isDictationPipelineSmokeRunning) return;

    const smokeSessionId = `dictation-pipeline-smoke-${Date.now()}`;
    const smokeText = `TypeFree smoke completion ${new Date().toISOString()}`;
    const checks: RuntimeProbeCheck[] = [];
    const addCheck = (check: RuntimeProbeCheck) => {
      checks.push(check);
      setRuntimeProbeChecks([...checks]);
    };
    let previousClipboardText: string | null = null;
    let clipboardRoundTrip = false;
    let clipboardRestored = false;
    let clipboardRestoreError: string | null = null;
    let savedHistoryId: number | null = null;

    setIsDictationPipelineSmokeRunning(true);
    setRuntimeProbeChecks([]);

    try {
      createDictationTimelineSession(smokeSessionId, "dictation-pipeline-smoke");
      addCheck({
        id: "dictation-pipeline-input",
        label: "Completion pipeline",
        status: "passed",
        detail: `Synthetic transcript length=${smokeText.length}`,
        meta: {
          source: "dictation-pipeline-smoke",
          skipCloudTranscription: true,
          pasteMode: "clipboard-write-roundtrip",
        },
      });

      try {
        previousClipboardText = await platform.clipboard.readText();
      } catch (clipboardError) {
        throw new Error(`Clipboard text snapshot unavailable: ${formatError(clipboardError)}`);
      }
      const clipboardTextToRestore = previousClipboardText;

      const dispatches: string[] = [];
      const completionResult = await runDictationCompletionPipeline({
        result: {
          success: true,
          text: smokeText,
          rawText: smokeText,
          normalizedText: smokeText,
          source: "dictation-pipeline-smoke",
          provider: "smoke",
          processingMode: "pipeline-smoke",
          usedReasoning: false,
          timings: {
            smoke: true,
          },
        },
        sessionId: smokeSessionId,
        guard: createDictationCompletionGuard(),
        stopRequested: true,
        insertDelayMs: 0,
        dispatchSession: (event) => {
          dispatches.push(event.type);
        },
        setTranscript: () => undefined,
        setLiveTranscript: () => undefined,
        setAudioLevel: () => undefined,
        hideWindow: async () => undefined,
        pasteText: async (text) => {
          let shouldRestoreClipboard = false;
          try {
            await platform.clipboard.writeText(text);
            shouldRestoreClipboard = true;
            const roundTripText = await platform.clipboard.readText();
            clipboardRoundTrip = roundTripText === text;
            return clipboardRoundTrip;
          } finally {
            if (shouldRestoreClipboard) {
              try {
                await platform.clipboard.writeText(clipboardTextToRestore);
                clipboardRestored = true;
              } catch (restoreError) {
                clipboardRestoreError = formatError(restoreError);
              }
            }
          }
        },
        saveTranscription: async (text, options) => {
          const saveResult = await platform.history.saveTranscription(
            text,
            undefined,
            undefined,
            undefined,
            options
          );
          const maybeId = (saveResult as { id?: number }).id;
          if (typeof maybeId === "number") {
            savedHistoryId = maybeId;
          }
          return saveResult;
        },
      });

      recordDictationPipelineSteps(smokeSessionId, "completion", completionResult.steps, {
        source: "dictation-pipeline-smoke",
        status: completionResult.status,
      });

      const insertStep = completionResult.steps.find((step) => step.name === "insert");
      const dbHistoryStep = completionResult.steps.find((step) => step.name === "db-history");
      const stepNames = completionResult.steps.map((step) => step.name);
      const expectedSteps: typeof stepNames = [
        "normalize",
        "dedupe",
        "ui",
        "insert",
        "clipboard-history",
        "db-history",
      ];
      const hasExpectedSteps = expectedSteps.every((step) => stepNames.includes(step));

      addCheck({
        id: "dictation-pipeline-steps",
        label: "Completion pipeline",
        status: completionResult.status === "failed" || !hasExpectedSteps ? "failed" : "passed",
        detail: `${completionResult.status}: ${stepNames.join(" -> ")}`,
        meta: {
          dispatches,
          steps: completionResult.steps,
        },
      });

      addCheck({
        id: "dictation-pipeline-insert",
        label: "Clipboard insert boundary",
        status:
          insertStep?.status === "completed" &&
          clipboardRoundTrip &&
          clipboardRestored &&
          !clipboardRestoreError
            ? "passed"
            : "failed",
        detail:
          clipboardRestoreError ||
          insertStep?.detail ||
          (clipboardRoundTrip ? "clipboard round-trip" : "no round-trip"),
        meta: {
          insertStatus: insertStep?.status || null,
          clipboardRoundTrip,
          clipboardRestored,
          clipboardRestoreError,
        },
      });

      addCheck({
        id: "dictation-pipeline-history",
        label: "History persistence",
        status:
          dbHistoryStep?.status === "completed" && savedHistoryId !== null ? "passed" : "failed",
        detail:
          dbHistoryStep?.status === "skipped"
            ? "db-history skipped; SQLite history was not verified"
            : dbHistoryStep?.detail || dbHistoryStep?.status || "missing db-history step",
        meta: {
          savedHistoryId,
          dbHistoryStatus: dbHistoryStep?.status || null,
        },
      });

      try {
        const persistedSession = await platform.history.getTranscriptionSession(smokeSessionId);
        addCheck({
          id: "dictation-pipeline-session",
          label: "History session",
          status: persistedSession ? "passed" : "failed",
          detail: persistedSession
            ? `Persisted session ${persistedSession.id}`
            : "Session was not available after history save",
          meta: {
            savedHistoryId,
            hasPersistedSession: !!persistedSession,
          },
        });
      } catch (sessionError) {
        addCheck({
          id: "dictation-pipeline-session",
          label: "History session",
          status: "failed",
          detail: formatError(sessionError),
          meta: {
            savedHistoryId,
          },
        });
      }
    } catch (error) {
      addCheck({
        id: "dictation-pipeline-smoke",
        label: "Completion pipeline",
        status: "failed",
        detail: formatError(error),
      });
    } finally {
      recordDictationTimelineEvent(smokeSessionId, {
        kind: "backend",
        label: "dictation-pipeline.smoke",
        status: checks.some((check) => check.status === "failed") ? "failed" : "completed",
        source: "dictation-pipeline-smoke",
        detail: formatRuntimeProbeTimelineDetail(checks),
        meta: createRuntimeProbeTimelineMeta(checks),
      });
      await flushDictationTimelinePersistence();
      await loadTimelineSessions();
      await emitDictationPipelineSmokeResult(createRuntimeProbeResult(smokeSessionId, checks));
      setIsDictationPipelineSmokeRunning(false);
    }
  }, [isDictationPipelineSmokeRunning, loadTimelineSessions]);

  const handleRunCloudCredentialPreflight = useCallback(async () => {
    if (isCloudCredentialPreflightRunning) return;

    const preflightSessionId = `cloud-credential-preflight-${Date.now()}`;
    const checks: RuntimeProbeCheck[] = [];
    const addCheck = (check: RuntimeProbeCheck) => {
      checks.push(check);
      setRuntimeProbeChecks([...checks]);
    };
    const provider = cloudTranscriptionSmokeOption(
      "cloudTranscriptionSmokeProvider",
      "PROVIDER",
      localStorage.getItem("cloudTranscriptionProvider") || "openai"
    );
    const model = cloudTranscriptionSmokeOption(
      "cloudTranscriptionSmokeModel",
      "MODEL",
      localStorage.getItem("cloudTranscriptionModel") || ""
    );
    const language = cloudTranscriptionSmokeOption(
      "cloudTranscriptionSmokeLanguage",
      "LANGUAGE",
      localStorage.getItem("preferredLanguage") || "auto"
    );

    setIsCloudCredentialPreflightRunning(true);
    setRuntimeProbeChecks([]);

    try {
      const providers = await platform.transcription.getProviders();
      const providerMetadata = providers.find((item) => item.id === provider);
      addCheck({
        id: "cloud-credential-provider",
        label: "Cloud credential preflight",
        status:
          providerMetadata && providerMetadata.capabilities.supports_batch ? "passed" : "failed",
        detail: providerMetadata
          ? `${providerMetadata.name || provider} batch=${providerMetadata.capabilities.supports_batch}`
          : `Provider ${provider || "(empty)"} is not in the Tauri provider catalog`,
        meta: {
          provider,
          model: model || null,
          language,
          supportsBatch: providerMetadata?.capabilities.supports_batch || false,
          presenceOnly: true,
        },
      });

      if (!providerMetadata || !providerMetadata.capabilities.supports_batch) {
        throw new Error(`Provider ${provider || "(empty)"} is not available for preflight`);
      }

      const requiredCredentialKeys = credentialKeysForCloudTranscriptionProvider(provider);
      const credentialStatuses = await Promise.all(
        requiredCredentialKeys.map((key) => platform.secrets.status(key))
      );
      const presentCredentialKeys = credentialStatuses
        .filter((status) => status.present)
        .map((status) => status.key);
      const missingCredentialKeys = credentialStatuses
        .filter((status) => !status.present)
        .map((status) => status.key);

      addCheck({
        id: "cloud-credential-preflight",
        label: "Cloud credential preflight",
        status: missingCredentialKeys.length === 0 ? "passed" : "warning",
        detail:
          missingCredentialKeys.length === 0
            ? `Credential presence verified for ${provider}`
            : `Missing credential keys: ${missingCredentialKeys.join(", ")}`,
        meta: {
          provider,
          model: model || null,
          language,
          requiredCredentialKeys,
          presentCredentialKeys,
          missingCredentialKeys,
          checkedAt: new Date().toISOString(),
          presenceOnly: true,
          recordingStarted: false,
          providerRequestStarted: false,
        },
      });
    } catch (error) {
      addCheck({
        id: "cloud-credential-preflight-error",
        label: "Cloud credential preflight",
        status: "failed",
        detail: formatError(error),
        meta: {
          provider,
          model: model || null,
          language,
          presenceOnly: true,
          recordingStarted: false,
          providerRequestStarted: false,
        },
      });
    } finally {
      await emitCloudCredentialPreflightResult(
        createRuntimeProbeResult(preflightSessionId, checks)
      );
      setIsCloudCredentialPreflightRunning(false);
    }
  }, [isCloudCredentialPreflightRunning]);

  const handleRunCloudTranscriptionSmoke = useCallback(async () => {
    if (isCloudTranscriptionSmokeRunning) return;

    const smokeSessionId = `cloud-transcription-smoke-${Date.now()}`;
    const checks: RuntimeProbeCheck[] = [];
    const addCheck = (check: RuntimeProbeCheck) => {
      checks.push(check);
      setRuntimeProbeChecks([...checks]);
    };
    const smokeDurationMs = cloudTranscriptionSmokeDurationMs();
    const provider = cloudTranscriptionSmokeOption(
      "cloudTranscriptionSmokeProvider",
      "PROVIDER",
      localStorage.getItem("cloudTranscriptionProvider") || "openai"
    );
    const model = cloudTranscriptionSmokeOption(
      "cloudTranscriptionSmokeModel",
      "MODEL",
      localStorage.getItem("cloudTranscriptionModel") || ""
    );
    const language = cloudTranscriptionSmokeOption(
      "cloudTranscriptionSmokeLanguage",
      "LANGUAGE",
      localStorage.getItem("preferredLanguage") || "auto"
    );
    const fixturePath = cloudTranscriptionFixturePath();
    const playbackPath = cloudTranscriptionPlaybackPath();
    let nativeRecordingStarted = false;
    let capturedAudio: Uint8Array | null = null;
    let transcriptionAudioBytes = 0;
    let playbackCleanup: (() => void) | null = null;

    setIsCloudTranscriptionSmokeRunning(true);
    setRuntimeProbeChecks([]);

    try {
      createDictationTimelineSession(smokeSessionId, "cloud-transcription-smoke");

      const providers = await platform.transcription.getProviders();
      const providerMetadata = providers.find((item) => item.id === provider);
      addCheck({
        id: "cloud-transcription-provider",
        label: "Cloud transcription",
        status:
          providerMetadata && providerMetadata.capabilities.supports_batch ? "passed" : "failed",
        detail: providerMetadata
          ? `${providerMetadata.name || provider} batch=${providerMetadata.capabilities.supports_batch}`
          : `Provider ${provider || "(empty)"} is not in the Tauri provider catalog`,
        meta: {
          provider,
          model: model || null,
          language,
          supportsBatch: providerMetadata?.capabilities.supports_batch || false,
        },
      });

      if (!providerMetadata || !providerMetadata.capabilities.supports_batch) {
        throw new Error(`Provider ${provider || "(empty)"} is not available for batch smoke`);
      }

      const requiredCredentialKeys = credentialKeysForCloudTranscriptionProvider(provider);
      const credentialStatuses = await Promise.all(
        requiredCredentialKeys.map((key) => platform.secrets.status(key))
      );
      const missingCredentialKeys = credentialStatuses
        .filter((status) => !status.present)
        .map((status) => status.key);
      addCheck({
        id: "cloud-transcription-credentials",
        label: "Cloud transcription credentials",
        status: missingCredentialKeys.length === 0 ? "passed" : "failed",
        detail:
          missingCredentialKeys.length === 0
            ? `Credential presence verified for ${provider}`
            : `Missing credential keys: ${missingCredentialKeys.join(", ")}`,
        meta: {
          provider,
          requiredCredentialKeys,
          presentCredentialKeys: credentialStatuses
            .filter((status) => status.present)
            .map((status) => status.key),
          missingCredentialKeys,
        },
      });

      if (missingCredentialKeys.length > 0) {
        throw new Error(`Missing provider credentials for ${provider}`);
      }

      if (fixturePath) {
        capturedAudio = await loadCloudTranscriptionFixtureAudio(fixturePath);
        const audioBytes = capturedAudio.byteLength;
        transcriptionAudioBytes = audioBytes;
        const wav = isWavAudioData(capturedAudio);
        const validFixture = audioBytes >= 44 && wav;

        addCheck({
          id: "cloud-transcription-speech-fixture",
          label: "Cloud transcription fixture",
          status: validFixture ? "passed" : "failed",
          detail: `Loaded speech fixture ${audioBytes} bytes`,
          meta: {
            audioBytes,
            wav,
            fixturePath,
            recordingStarted: false,
            audioSource: "speech-fixture",
          },
        });

        if (!validFixture) {
          throw new Error("Cloud transcription fixture did not contain valid WAV audio");
        }
      } else {
        const capabilities = await platform.recording.getNativeCapabilities();
        const capabilitiesReady = capabilities.supported && !capabilities.active;
        addCheck({
          id: "cloud-transcription-recording-capabilities",
          label: "Cloud transcription recording",
          status: capabilitiesReady ? "passed" : "failed",
          detail: capabilitiesReady
            ? `${capabilities.backend || "unknown"}@${capabilities.platform || "unknown"} ${
                capabilities.status || "ready"
              }`
            : capabilities.active
              ? "Native recorder is already active"
              : capabilities.reason || "Native recorder is not supported",
          meta: {
            backend: capabilities.backend,
            platform: capabilities.platform,
            recorderStatus: capabilities.status,
            supported: capabilities.supported,
            active: capabilities.active,
            reason: capabilities.reason || null,
          },
        });

        if (!capabilitiesReady) {
          throw new Error("Native recording is required for cloud transcription smoke");
        }

        const started = await platform.recording.startNative();
        nativeRecordingStarted = started === true;
        addCheck({
          id: "cloud-transcription-recording-start",
          label: "Cloud transcription recording",
          status: nativeRecordingStarted ? "passed" : "failed",
          detail: nativeRecordingStarted
            ? `Started native recording for ${smokeDurationMs}ms`
            : "Native recorder did not report a successful start",
        });

        if (!nativeRecordingStarted) {
          throw new Error("Native recorder did not start");
        }

        if (playbackPath) {
          const playback = await playCloudTranscriptionPlaybackAudio(playbackPath);
          playbackCleanup = playback.cleanup;
          addCheck({
            id: "cloud-transcription-speaker-playback",
            label: "Cloud transcription playback",
            status: "passed",
            detail: `Playing speaker fixture ${playback.audioBytes} bytes during native recording`,
            meta: {
              audioBytes: playback.audioBytes,
              audioSource: "speaker-playback",
              playbackPath,
              recordingStarted: true,
              wav: playback.wav,
            },
          });
        }

        await waitForSmokeDuration(smokeDurationMs);
        const recordingResult = await platform.recording.stopNative();
        nativeRecordingStarted = false;
        capturedAudio = recordingResult?.audioData || null;
        const audioBytes = capturedAudio?.byteLength || 0;
        transcriptionAudioBytes = audioBytes;
        const mimeType = recordingResult?.mimeType || "";
        const durationSeconds = recordingResult?.durationSeconds ?? null;
        const wav = isWavAudioData(capturedAudio);
        const validCapture = audioBytes >= 44 && wav;

        addCheck({
          id: "cloud-transcription-recording-capture",
          label: "Cloud transcription recording",
          status: validCapture ? "passed" : "failed",
          detail: `Captured ${audioBytes} bytes as ${mimeType || "unknown"}${
            durationSeconds ? ` in ${durationSeconds.toFixed(2)}s` : ""
          }`,
          meta: {
            audioBytes,
            mimeType,
            durationSeconds,
            wav,
            smokeDurationMs,
          },
        });

        if (!validCapture || !capturedAudio) {
          throw new Error("Cloud transcription smoke did not capture valid WAV audio");
        }
      }

      const startedAt = performance.now();
      const transcript = await platform.transcription.transcribeAudio(
        capturedAudio,
        provider,
        model || undefined,
        language || undefined,
        smokeSessionId
      );
      const durationMs = Math.round(performance.now() - startedAt);
      const transcriptLength = transcript.trim().length;
      addCheck({
        id: "cloud-transcription-result",
        label: "Cloud transcription",
        status: transcriptLength > 0 ? "passed" : "failed",
        detail:
          transcriptLength > 0
            ? `Received transcript length=${transcriptLength} in ${durationMs}ms`
            : "Provider returned an empty transcript",
        meta: {
          provider,
          model: model || null,
          language,
          durationMs,
          transcriptLength,
          audioBytes: transcriptionAudioBytes,
          audioSource: fixturePath ? "speech-fixture" : "native-recording",
        },
      });
    } catch (error) {
      addCheck({
        id: "cloud-transcription-smoke",
        label: "Cloud transcription",
        status: "failed",
        detail: formatError(error),
        meta: {
          provider,
          model: model || null,
          language,
          fixturePath: fixturePath || null,
          playbackPath: playbackPath || null,
          ...formatErrorMeta(error),
        },
      });
    } finally {
      playbackCleanup?.();
      if (nativeRecordingStarted) {
        try {
          await platform.recording.cancelNative();
          addCheck({
            id: "cloud-transcription-recording-cancel",
            label: "Cloud transcription recording",
            status: "warning",
            detail: "Cancelled native recorder after smoke failure",
          });
        } catch (cancelError) {
          addCheck({
            id: "cloud-transcription-recording-cancel",
            label: "Cloud transcription recording",
            status: "failed",
            detail: formatError(cancelError),
          });
        }
      }

      recordDictationTimelineEvent(smokeSessionId, {
        kind: checks.some((check) => check.status === "failed") ? "error" : "transcription",
        label: "cloud-transcription.smoke",
        status: checks.some((check) => check.status === "failed") ? "failed" : "completed",
        source: "cloud-transcription-smoke",
        detail: formatRuntimeProbeTimelineDetail(checks),
        meta: {
          ...createRuntimeProbeTimelineMeta(checks),
          provider,
          model: model || null,
          language,
          audioSource: fixturePath ? "speech-fixture" : "native-recording",
          playbackPath: playbackPath || null,
        },
      });
      await flushDictationTimelinePersistence();
      await loadTimelineSessions();
      await emitCloudTranscriptionSmokeResult(createRuntimeProbeResult(smokeSessionId, checks));
      setIsCloudTranscriptionSmokeRunning(false);
    }
  }, [isCloudTranscriptionSmokeRunning, loadTimelineSessions]);

  useEffect(() => {
    if (runtimeProbeAutorunRef.current || !shouldAutorunRuntimeProbe()) return;

    const timer = window.setTimeout(() => {
      runtimeProbeAutorunRef.current = true;
      void handleRunRuntimeProbe();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [handleRunRuntimeProbe]);

  useEffect(() => {
    if (
      nativeRecordingSmokeAutorunRef.current ||
      !shouldAutorunNativeRecordingSmoke() ||
      shouldAutorunRuntimeProbe() ||
      shouldAutorunDictationPipelineSmoke() ||
      shouldAutorunCloudCredentialPreflight() ||
      shouldAutorunCloudTranscriptionSmoke()
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      nativeRecordingSmokeAutorunRef.current = true;
      void handleRunNativeRecordingSmoke();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [handleRunNativeRecordingSmoke]);

  useEffect(() => {
    if (
      dictationPipelineSmokeAutorunRef.current ||
      !shouldAutorunDictationPipelineSmoke() ||
      shouldAutorunRuntimeProbe() ||
      shouldAutorunCloudCredentialPreflight() ||
      shouldAutorunCloudTranscriptionSmoke()
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      dictationPipelineSmokeAutorunRef.current = true;
      void handleRunDictationPipelineSmoke();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [handleRunDictationPipelineSmoke]);

  useEffect(() => {
    if (
      cloudCredentialPreflightAutorunRef.current ||
      !shouldAutorunCloudCredentialPreflight() ||
      shouldAutorunRuntimeProbe() ||
      shouldAutorunNativeRecordingSmoke() ||
      shouldAutorunDictationPipelineSmoke() ||
      shouldAutorunCloudTranscriptionSmoke()
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      cloudCredentialPreflightAutorunRef.current = true;
      void handleRunCloudCredentialPreflight();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [handleRunCloudCredentialPreflight]);

  useEffect(() => {
    if (
      cloudTranscriptionSmokeAutorunRef.current ||
      !shouldAutorunCloudTranscriptionSmoke() ||
      shouldAutorunRuntimeProbe() ||
      shouldAutorunCloudCredentialPreflight()
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      cloudTranscriptionSmokeAutorunRef.current = true;
      void handleRunCloudTranscriptionSmoke();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [handleRunCloudTranscriptionSmoke]);

  const handleToggleDebug = async () => {
    if (isToggling) return;

    try {
      setIsToggling(true);
      const newState = !debugEnabled;
      const result = await platform.debug.setLogging(newState);

      if (!result.success) {
        throw new Error(result.error || "Failed to update debug logging");
      }

      setDebugEnabled(newState);

      // Reload the state to get updated log path
      await loadDebugState();

      toast({
        title: newState ? "Debug Logging Enabled" : "Debug Logging Disabled",
        description: newState
          ? "Detailed logs are now being written to disk"
          : "Debug logging has been turned off",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to toggle debug logging: ${error}`,
        variant: "destructive",
      });
    } finally {
      setIsToggling(false);
    }
  };

  const handleOpenLogsFolder = async () => {
    try {
      const result = await platform.debug.openLogsFolder();
      if (!result.success) {
        throw new Error(result.error || "Failed to open folder");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to open logs folder: ${error}`,
        variant: "destructive",
      });
    }
  };

  const handleCopyPath = async () => {
    if (!logPath) return;

    try {
      await navigator.clipboard.writeText(logPath);
      setCopiedPath(true);
      toast({
        title: "Copied",
        description: "Log file path copied to clipboard",
        variant: "success",
        duration: 2000,
      });
      setTimeout(() => setCopiedPath(false), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Could not copy path to clipboard",
        variant: "destructive",
      });
    }
  };

  const detectedApp =
    formatApplication(privacyDiagnostics?.detectedForeground) || t("developer.privacy.none");
  const activeApp =
    formatApplication(privacyDiagnostics?.activeForeground) || t("developer.privacy.none");
  const blacklist =
    privacyDiagnostics && privacyDiagnostics.applicationBlacklist.length > 0
      ? privacyDiagnostics.applicationBlacklist.join(", ")
      : t("developer.privacy.none");
  const detectedCandidates =
    privacyDiagnostics && privacyDiagnostics.detectedCandidates.length > 0
      ? privacyDiagnostics.detectedCandidates.join(", ")
      : t("developer.privacy.none");
  const activeCandidates =
    privacyDiagnostics && privacyDiagnostics.activeCandidates.length > 0
      ? privacyDiagnostics.activeCandidates.join(", ")
      : t("developer.privacy.none");
  const retentionText = privacyDiagnostics?.effectiveHistoryRetentionDays
    ? t("developer.privacy.retentionDays", {
        count: privacyDiagnostics.effectiveHistoryRetentionDays,
      })
    : t("developer.privacy.retentionOff");

  return (
    <div className="space-y-6">
      <p className="settings-page-lede">{t("developer.debugLoggingDesc")}</p>

      {/* Main Debug Logging Card */}
      <div className="space-y-4 p-6 bg-linear-to-br from-neutral-50 via-white to-neutral-100 border border-neutral-200 rounded-xl shadow-sm">
        {/* Header with status */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-neutral-900 rounded-lg">
              <Wrench className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="font-semibold text-neutral-900">{t("developer.debugLogging")}</h4>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className={`w-2 h-2 rounded-full ${
                    debugEnabled
                      ? "bg-neutral-900 animate-pulse shadow-lg shadow-neutral-900/30"
                      : "bg-neutral-300"
                  }`}
                />
                <span className="text-xs font-medium text-neutral-600">
                  {isLoading
                    ? t("common.loading")
                    : debugEnabled
                      ? t("developer.active")
                      : t("developer.inactive")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-neutral-600 leading-relaxed">{t("developer.cardDesc")}</p>

        {/* Log Path Display - Only when active */}
        {debugEnabled && logPath && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
              {t("developer.currentLogFile")}
            </label>
            <div className="flex gap-2">
              <div className="flex-1 p-3 bg-neutral-950 rounded-lg border border-neutral-800 overflow-hidden">
                <code className="text-xs text-neutral-100 break-all leading-relaxed">
                  {logPath}
                </code>
              </div>
              <Button
                onClick={handleCopyPath}
                variant="outline"
                size="icon"
                className="h-12 w-12 border-neutral-300 hover:bg-neutral-100"
                title={t("developer.copyLogPath")}
              >
                {copiedPath ? (
                  <Check className="h-4 w-4 text-neutral-900" />
                ) : (
                  <Copy className="h-4 w-4 text-neutral-600" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <Button
            onClick={handleToggleDebug}
            disabled={isLoading || isToggling}
            className={`flex-1 font-medium ${
              debugEnabled
                ? "bg-neutral-700 hover:bg-neutral-800 text-white shadow-md shadow-neutral-700/20"
                : "bg-neutral-900 hover:bg-neutral-800 text-white shadow-md shadow-neutral-900/20"
            }`}
          >
            {isToggling ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                {debugEnabled ? t("developer.disabling") : t("developer.enabling")}
              </>
            ) : (
              <>{debugEnabled ? t("developer.disableDebug") : t("developer.enableDebug")}</>
            )}
          </Button>

          <Button
            onClick={handleOpenLogsFolder}
            variant="outline"
            disabled={!debugEnabled || isLoading}
            className={`flex-1 font-medium ${
              debugEnabled
                ? "border-neutral-300 hover:bg-neutral-100 hover:border-neutral-400"
                : "opacity-50 cursor-not-allowed"
            }`}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("developer.openLogsFolder")}
          </Button>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-neutral-900 p-2">
              <Check className="h-5 w-5 text-white" />
            </div>
            <div>
              <h4 className="font-semibold text-neutral-900">
                {t("developer.runtimeProbe.title")}
              </h4>
              <div className="mt-1 text-xs font-medium text-neutral-500">
                {t("developer.runtimeProbe.subtitle")}
              </div>
            </div>
          </div>
          <Button
            onClick={handleRunRuntimeProbe}
            variant="outline"
            size="sm"
            disabled={isRuntimeProbeRunning}
            className="border-neutral-300 hover:bg-neutral-100"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isRuntimeProbeRunning ? "animate-spin" : ""}`} />
            {isRuntimeProbeRunning
              ? t("developer.runtimeProbe.running")
              : t("developer.runtimeProbe.run")}
          </Button>
        </div>

        {runtimeProbeChecks.length > 0 ? (
          <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-4">
            {runtimeProbeChecks.map((check) => (
              <ProbeRow key={check.id} check={check} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">
            {t("developer.runtimeProbe.empty")}
          </div>
        )}
      </div>

      <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-neutral-900 p-2">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <h4 className="font-semibold text-neutral-900">{t("developer.timeline")}</h4>
              <div className="mt-1 text-xs font-medium text-neutral-500">
                {t("developer.timeline.sessions", { count: timelineSessions.length })}
              </div>
            </div>
          </div>
          <Button
            onClick={handleRefreshTimeline}
            variant="outline"
            size="sm"
            className="border-neutral-300 hover:bg-neutral-100"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isTimelineRefreshing ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
        </div>

        {timelineSessions.length > 0 ? (
          <div className="space-y-3">
            {timelineSessions.map((session) => (
              <TimelineSessionCard key={session.sessionId} session={session} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
            {t("developer.timeline.empty")}
          </div>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-neutral-900 p-2">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <h4 className="font-semibold text-neutral-900">{t("developer.privacy.title")}</h4>
              <div className="mt-1 text-xs font-medium text-neutral-500">
                {t("developer.privacy.subtitle")}
              </div>
            </div>
          </div>
          <Button
            onClick={handleRefreshPrivacyDiagnostics}
            variant="outline"
            size="sm"
            className="border-neutral-300 hover:bg-neutral-100"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isPrivacyRefreshing ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <DecisionPill
            active={Boolean(privacyDiagnostics?.wouldSkipTranscriptionHistory)}
            activeText={t("developer.privacy.historySkipped")}
            inactiveText={t("developer.privacy.historyRecorded")}
          />
          <DecisionPill
            active={Boolean(privacyDiagnostics?.wouldSkipClipboardCapture)}
            activeText={t("developer.privacy.clipboardSkipped")}
            inactiveText={t("developer.privacy.clipboardCaptured")}
          />
          <DecisionPill
            active={Boolean(privacyDiagnostics?.activeApplicationBlacklisted)}
            activeText={t("developer.privacy.activeMatched")}
            inactiveText={t("developer.privacy.activeClear")}
          />
          <DecisionPill
            active={Boolean(privacyDiagnostics?.detectedApplicationBlacklisted)}
            activeText={t("developer.privacy.detectedMatched")}
            inactiveText={t("developer.privacy.detectedClear")}
          />
        </div>

        <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-4">
          <DiagnosticRow label={t("developer.privacy.foreground")} value={detectedApp} />
          <DiagnosticRow label={t("developer.privacy.active")} value={activeApp} />
          <DiagnosticRow label={t("developer.privacy.blacklist")} value={blacklist} />
          <DiagnosticRow
            label={t("developer.privacy.detectedCandidates")}
            value={detectedCandidates}
          />
          <DiagnosticRow label={t("developer.privacy.activeCandidates")} value={activeCandidates} />
          <DiagnosticRow label={t("developer.privacy.retention")} value={retentionText} />
        </div>

        {privacyDiagnostics?.detectionError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-medium">{t("developer.privacy.detectionError")}: </span>
            <span className="break-all font-mono text-xs">{privacyDiagnostics.detectionError}</span>
          </div>
        )}
      </div>

      {/* Sharing Instructions - Only when enabled */}
      {debugEnabled && (
        <div className="p-5 bg-linear-to-br from-neutral-50 to-gray-100 border border-neutral-200 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-neutral-900 rounded-lg mt-0.5">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-neutral-900 mb-2">{t("developer.howToShare")}</h4>
              <div className="text-sm text-neutral-800 space-y-2">
                <p>{t("developer.shareDesc")}</p>
                <ol className="space-y-1 ml-4 list-decimal">
                  <li>{t("developer.shareStep1")}</li>
                  <li>{t("developer.shareStep2")}</li>
                  <li>{t("developer.shareStep3")}</li>
                  <li>{t("developer.shareStep4")}</li>
                </ol>
                <p className="text-xs text-neutral-700 mt-3 pt-3 border-t border-neutral-200">
                  {t("developer.sharePrivacy")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Information Cards */}
      <div className="grid grid-cols-1 gap-4">
        {/* What Gets Logged */}
        <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-neutral-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-neutral-900 mb-2">{t("developer.whatLogged")}</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-neutral-800">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-neutral-600" />
                  <span>{t("developer.log.audio")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-neutral-600" />
                  <span>{t("developer.log.api")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-neutral-600" />
                  <span>{t("developer.log.ffmpeg")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-neutral-600" />
                  <span>{t("developer.log.system")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-neutral-600" />
                  <span>{t("developer.log.pipeline")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-neutral-600" />
                  <span>{t("developer.log.error")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Note */}
        {debugEnabled && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-medium text-amber-900 mb-1">{t("developer.perfNote")}</h4>
                <p className="text-sm text-amber-800">{t("developer.perfNoteDesc")}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
