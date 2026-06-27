import ReasoningService from "../../../services/ReasoningService";
import VolcengineASRService from "../../../services/VolcengineASRService";
import { API_ENDPOINTS, buildApiUrl, normalizeBaseUrl } from "../../../config/constants";
import { getTranscriptionProvider } from "../../../models/ModelRegistry";
import logger from "../../../utils/logger";
import { isBuiltInMicrophone } from "../../../utils/audioDeviceUtils";
import { isSecureEndpoint } from "../../../utils/urlUtils";
import defaultPlatform from "../../../shared/platform";
import type {
  NativeRecordingCapabilities,
  PlatformBridge,
  PlatformListenerCleanup,
  PlatformUnlisten,
  SaveTranscriptionOptions,
  TranscriptionProvider,
  TranscriptionProviderCapabilities,
} from "../../../shared/platform";
import { syncVocabularySettingsToBackend } from "../../../utils/vocabulary";
import { runTranscriptionPostProcessingPipeline } from "../pipeline/transcriptionPipeline";
import type {
  AudioManagerCallbacks,
  AudioManagerState,
  AudioManagerTranscriptionTimings,
  AudioManagerTranscriptionResult,
} from "./audioManagerTypes";

type WindowWithWebkitAudioContext = Window &
  typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };

type MutableStreamingState = Record<string, any>;
type ReasoningAvailabilityCache = {
  value: boolean;
  expiresAt: number;
};
type ProcessingTimings = AudioManagerTranscriptionTimings & {
  audioQualityProcessingDurationMs?: number;
};
type AudioQualityMetadata = {
  processed?: boolean;
  noiseGateEnabled?: boolean;
  preRollMs?: number;
  processingDurationMs?: number;
};
type AudioProcessingMetadata = {
  durationSeconds?: number | null;
  sessionId?: string | null;
  audioQuality?: AudioQualityMetadata;
};
type PrepareAudioOptions = {
  allowContainerRewrite?: boolean;
};
type ProcessingTimeoutContext = ReturnType<typeof createProcessingTimeoutContext>;
type TranscriptionProviderMetadata = {
  id: string;
  name?: string;
  requires_key?: boolean;
  default_base_url?: string | null;
  supports_endpoint_override?: boolean;
  capabilities: TranscriptionProviderCapabilities;
};
type ProviderCapabilitiesById = Record<string, TranscriptionProviderMetadata>;
type ProviderCapabilityCache = {
  byProvider: ProviderCapabilitiesById;
  expiresAt: number;
};

const SHORT_CLIP_DURATION_SECONDS = 2.5;
const REASONING_CACHE_TTL = 30000; // 30 seconds
const PROVIDER_CAPABILITY_CACHE_TTL = 30000; // 30 seconds
const PROCESSING_MAX_WAIT_MS = 60000;
const PROCESSING_TIMEOUT_MESSAGE = "Processing timed out after 60 seconds";
const ASSEMBLYAI_POLL_INTERVAL_MS = 1000;
const ASSEMBLYAI_MAX_WAIT_MS = 180000;
const STREAMING_PCM_SAMPLE_RATE = 16000;
const STREAMING_PCM_SAMPLES_PER_CHUNK = 3200; // 200ms at 16kHz
const OPENAI_REALTIME_PCM_SAMPLE_RATE = 24000;
const OPENAI_REALTIME_PCM_SAMPLES_PER_CHUNK = 4800; // 200ms at 24kHz
const OPENAI_REALTIME_MODEL = "gpt-realtime-whisper";
const OPENAI_REALTIME_FALLBACK_MODEL = "gpt-4o-mini-transcribe";
const RECORDING_FEEDBACK_MUTE_DELAY_MS = 450;
const RECORDING_MAX_DURATION_DEFAULT_SECONDS = 300;
const RECORDING_MAX_DURATION_MIN_SECONDS = 15;
const RECORDING_MAX_DURATION_MAX_SECONDS = 3600;
const AUDIO_QUALITY_PRE_ROLL_DEFAULT_MS = 250;
const AUDIO_QUALITY_PRE_ROLL_MIN_MS = 0;
const AUDIO_QUALITY_PRE_ROLL_MAX_MS = 2000;
const AUDIO_QUALITY_OUTPUT_SAMPLE_RATE = 16000;
const AUDIO_QUALITY_FRAME_SECONDS = 0.02;
const AUDIO_QUALITY_TRIM_PADDING_SECONDS = 0.18;
const AUDIO_QUALITY_MIN_OUTPUT_SECONDS = 0.35;
const AUDIO_QUALITY_SILENCE_FLOOR = 0.0025;
const AUDIO_QUALITY_BASE_ACTIVITY_THRESHOLD = 0.0035;
const AUDIO_QUALITY_GATE_FLOOR = 0.002;

const PLACEHOLDER_KEYS = {
  assemblyai: "your_assemblyai_api_key_here",
  openai: "your_openai_api_key_here",
  groq: "your_groq_api_key_here",
  zai: "your_zai_api_key_here",
};

const getFallbackProviderBaseUrl = (providerId: string) =>
  getTranscriptionProvider(providerId)?.baseUrl || "";

const FALLBACK_PROVIDER_METADATA: ProviderCapabilitiesById = {
  assemblyai: {
    id: "assemblyai",
    default_base_url: getFallbackProviderBaseUrl("assemblyai"),
    supports_endpoint_override: true,
    capabilities: {
      supports_batch: true,
      supports_streaming: false,
      supports_realtime: false,
    },
  },
  openai: {
    id: "openai",
    default_base_url: getFallbackProviderBaseUrl("openai"),
    supports_endpoint_override: true,
    capabilities: {
      supports_batch: true,
      supports_streaming: false,
      supports_realtime: true,
    },
  },
  groq: {
    id: "groq",
    default_base_url: getFallbackProviderBaseUrl("groq"),
    supports_endpoint_override: true,
    capabilities: {
      supports_batch: true,
      supports_streaming: false,
      supports_realtime: false,
    },
  },
  zai: {
    id: "zai",
    default_base_url: getFallbackProviderBaseUrl("zai"),
    supports_endpoint_override: true,
    capabilities: {
      supports_batch: true,
      supports_streaming: false,
      supports_realtime: false,
    },
  },
  volcengine: {
    id: "volcengine",
    default_base_url: getFallbackProviderBaseUrl("volcengine"),
    supports_endpoint_override: false,
    capabilities: {
      supports_batch: true,
      supports_streaming: true,
      supports_realtime: false,
    },
  },
};

const resolveProviderDefaultBaseUrl = (
  providerMetadata: TranscriptionProviderMetadata | null | undefined
) => {
  const rawBase =
    typeof providerMetadata?.default_base_url === "string"
      ? providerMetadata.default_base_url.trim()
      : "";
  return rawBase ? normalizeBaseUrl(rawBase) || rawBase.replace(/\/+$/, "") : "";
};

const buildTranscriptionEndpointForProvider = (provider: string, base: string) => {
  const normalizedBase = normalizeBaseUrl(base) || base.trim().replace(/\/+$/, "");
  if (!normalizedBase) return "";

  if (provider === "assemblyai") {
    return normalizedBase.replace(/\/+$/, "");
  }

  if (provider === "zai") {
    if (/\/paas\/v4\/audio\/transcriptions$/i.test(normalizedBase)) {
      return normalizedBase;
    }
    return buildApiUrl(normalizedBase, "/paas/v4/audio/transcriptions");
  }

  if (provider === "volcengine") {
    return normalizedBase;
  }

  if (/\/audio\/(transcriptions|translations)$/i.test(normalizedBase)) {
    return normalizedBase;
  }

  return buildApiUrl(normalizedBase, "/audio/transcriptions");
};

const createAbortError = () => {
  try {
    return new DOMException("Aborted", "AbortError");
  } catch {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
  }
};

const sleep = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = window.setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    };

    signal?.addEventListener?.("abort", onAbort, { once: true });
  });

const createProcessingTimeoutContext = (timeoutMs = PROCESSING_MAX_WAIT_MS) => {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const deadlineAt = Date.now() + timeoutMs;
  let timedOut = false;
  let rejectTimeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    rejectTimeout = reject;
  });
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller?.abort();
    rejectTimeout?.(new Error(PROCESSING_TIMEOUT_MESSAGE));
  }, timeoutMs);

  return {
    signal: controller?.signal,
    deadlineAt,
    timeoutPromise,
    hasTimedOut: () => timedOut || Date.now() > deadlineAt,
    dispose: () => window.clearTimeout(timeoutId),
  };
};

const isZaiEndpoint = (endpoint) => {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    return (
      /(^|\.)api\.z\.ai$/i.test(url.hostname) || /(^|\.)open\.bigmodel\.cn$/i.test(url.hostname)
    );
  } catch {
    return (
      /\/\/api\.z\.ai\b/i.test(String(endpoint)) ||
      /\/\/open\.bigmodel\.cn\b/i.test(String(endpoint))
    );
  }
};

const isAssemblyAIEndpoint = (endpoint) => {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    return /(^|\.)api\.assemblyai\.com$/i.test(url.hostname);
  } catch {
    return /\/\/api\.assemblyai\.com\b/i.test(String(endpoint));
  }
};

const isValidApiKey = (key, provider = "openai") => {
  if (!key || key.trim() === "") return false;
  const placeholder = PLACEHOLDER_KEYS[provider] || PLACEHOLDER_KEYS.openai;
  return key !== placeholder;
};

const getAudioContextConstructor = () => {
  if (typeof window === "undefined") return null;
  const browserWindow = window as WindowWithWebkitAudioContext;
  return browserWindow.AudioContext || browserWindow.webkitAudioContext || null;
};

const resolvePlatformUnlisten = async (
  cleanup: PlatformListenerCleanup
): Promise<PlatformUnlisten | null> => {
  const resolved = await cleanup;
  return typeof resolved === "function" ? resolved : null;
};

const callPlatformUnlisten = (unlisten: unknown): void => {
  if (typeof unlisten === "function") {
    unlisten();
  }
};

const normalizeProviderCapabilities = (
  provider: TranscriptionProvider
): TranscriptionProviderMetadata | null => {
  const capabilities = provider?.capabilities;
  if (!capabilities) return null;

  return {
    id: provider.id,
    name: provider.name,
    requires_key: provider.requires_key === true,
    default_base_url:
      typeof provider.default_base_url === "string" && provider.default_base_url.trim()
        ? provider.default_base_url.trim()
        : null,
    supports_endpoint_override: provider.supports_endpoint_override === true,
    capabilities: {
      supports_batch: capabilities.supports_batch === true,
      supports_streaming: capabilities.supports_streaming === true,
      supports_realtime: capabilities.supports_realtime === true,
    },
  };
};

class AudioManager {
  platform: PlatformBridge;
  mediaRecorder: MediaRecorder | null;
  audioChunks: Blob[];
  isRecording: boolean;
  isProcessing: boolean;
  isStarting: boolean;
  stopRequestedDuringStart: boolean;
  onStateChange: AudioManagerCallbacks["onStateChange"] | null;
  onError: AudioManagerCallbacks["onError"] | null;
  onTranscriptionComplete: AudioManagerCallbacks["onTranscriptionComplete"] | null;
  onLiveTranscript: AudioManagerCallbacks["onLiveTranscript"] | null;
  onAudioLevel: AudioManagerCallbacks["onAudioLevel"] | null;
  getSessionId: NonNullable<AudioManagerCallbacks["getSessionId"]> | null;
  cachedApiKey: string | null;
  cachedApiKeyProvider: string | null;
  cachedTranscriptionEndpoint: string | null;
  cachedEndpointProvider: string | null;
  cachedEndpointBaseUrl: string | null;
  cachedEndpointDefaultBaseUrl: string | null;
  recordingStartTime: number | null;
  recordingMimeType: string | null;
  nativeRecordingCapabilities: NativeRecordingCapabilities | null;
  recordingMaxDurationTimer: number | null;
  reasoningAvailabilityCache: ReasoningAvailabilityCache;
  cachedReasoningPreference: string | null;
  audioDuckingActive: boolean;
  audioDuckingRefreshTimer: number | null;
  audioDuckingGeneration: number;
  transcriptionProviderCapabilityCache: ProviderCapabilityCache | null;
  volcStreaming: MutableStreamingState | null;
  volcStreamingSendChain: Promise<unknown>;
  volcStreamingSendFailed: boolean;
  openAIRealtime: MutableStreamingState | null;
  openAIRealtimeSendChain: Promise<unknown>;
  openAIRealtimeSendFailed: boolean;

  constructor(platform = defaultPlatform) {
    this.platform = platform;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isProcessing = false;
    this.isStarting = false;
    this.stopRequestedDuringStart = false;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onLiveTranscript = null;
    this.onAudioLevel = null;
    this.getSessionId = null;
    this.cachedApiKey = null;
    this.cachedApiKeyProvider = null;
    this.cachedTranscriptionEndpoint = null;
    this.cachedEndpointProvider = null;
    this.cachedEndpointBaseUrl = null;
    this.cachedEndpointDefaultBaseUrl = null;
    this.recordingStartTime = null;
    this.nativeRecordingCapabilities = null;
    this.recordingMaxDurationTimer = null;
    this.reasoningAvailabilityCache = { value: false, expiresAt: 0 };
    this.cachedReasoningPreference = null;
    this.audioDuckingActive = false;
    this.audioDuckingRefreshTimer = null;
    this.audioDuckingGeneration = 0;
    this.transcriptionProviderCapabilityCache = null;
    this.volcStreaming = null;
    this.volcStreamingSendChain = Promise.resolve();
    this.volcStreamingSendFailed = false;
    this.openAIRealtime = null;
    this.openAIRealtimeSendChain = Promise.resolve();
    this.openAIRealtimeSendFailed = false;
  }

  /** @param {AudioManagerCallbacks} callbacks */
  setCallbacks({
    onStateChange,
    onError,
    onTranscriptionComplete,
    onLiveTranscript,
    onAudioLevel,
    getSessionId,
  }) {
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onTranscriptionComplete = onTranscriptionComplete;
    this.onLiveTranscript = onLiveTranscript;
    this.onAudioLevel = onAudioLevel;
    this.getSessionId = getSessionId || null;
  }

  currentSessionId(source = "renderer") {
    try {
      return this.getSessionId?.(source) || null;
    } catch {
      return null;
    }
  }

  async readSecretCredential(key: string): Promise<string> {
    try {
      const value = await this.platform.secrets.get(key);
      return typeof value === "string" ? value.trim() : "";
    } catch {
      return "";
    }
  }

  isNativeRecordingSupported() {
    try {
      if (this.nativeRecordingCapabilities) {
        return (
          this.nativeRecordingCapabilities.supported === true &&
          typeof this.platform.recording.startNative === "function" &&
          typeof this.platform.recording.stopNative === "function" &&
          typeof this.platform.recording.cancelNative === "function"
        );
      }

      // Compatibility fallback for older bridges that predate recorder capabilities.
      if (typeof window === "undefined" || typeof navigator === "undefined") {
        return false;
      }
      const isMac = /\bMac\b|\bDarwin\b/i.test(navigator.platform || navigator.userAgent || "");
      return (
        isMac &&
        typeof this.platform.recording.startNative === "function" &&
        typeof this.platform.recording.stopNative === "function" &&
        typeof this.platform.recording.cancelNative === "function"
      );
    } catch {
      return false;
    }
  }

  async loadNativeRecordingCapabilities() {
    if (this.nativeRecordingCapabilities) {
      return this.nativeRecordingCapabilities;
    }

    try {
      if (typeof this.platform.recording.getNativeCapabilities === "function") {
        this.nativeRecordingCapabilities = await this.platform.recording.getNativeCapabilities();
      } else {
        this.nativeRecordingCapabilities = {
          supported: this.isNativeRecordingSupported(),
          platform: "unknown",
          backend: "legacy-native-recorder",
          status: "legacy",
          reason: null,
          active: false,
        };
      }
    } catch (error) {
      this.nativeRecordingCapabilities = {
        supported: false,
        platform: "unknown",
        backend: "unknown",
        status: "unavailable",
        reason: error?.message || String(error),
        active: false,
      };
    }

    return this.nativeRecordingCapabilities;
  }

  async shouldUseNativeRecording() {
    const capabilities = await this.loadNativeRecordingCapabilities();
    return (
      capabilities?.supported === true &&
      typeof this.platform.recording.startNative === "function" &&
      typeof this.platform.recording.stopNative === "function" &&
      typeof this.platform.recording.cancelNative === "function"
    );
  }

  getCloudTranscriptionProvider() {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
      : "openai";
  }

  async loadTranscriptionProviderCapabilities(): Promise<ProviderCapabilitiesById> {
    const now = Date.now();
    if (
      this.transcriptionProviderCapabilityCache &&
      this.transcriptionProviderCapabilityCache.expiresAt > now
    ) {
      return this.transcriptionProviderCapabilityCache.byProvider;
    }

    const byProvider: ProviderCapabilitiesById = { ...FALLBACK_PROVIDER_METADATA };

    try {
      if (typeof this.platform.transcription.getProviders === "function") {
        const providers = await this.platform.transcription.getProviders();
        for (const provider of providers || []) {
          if (!provider?.id) continue;
          const capabilities = normalizeProviderCapabilities(provider);
          if (!capabilities) continue;
          byProvider[provider.id] = capabilities;
        }
      }
    } catch (error) {
      logger.warn(
        "Failed to load transcription provider capabilities; using fallback matrix",
        { error: error?.message || String(error) },
        "transcription"
      );
    }

    this.transcriptionProviderCapabilityCache = {
      byProvider,
      expiresAt: now + PROVIDER_CAPABILITY_CACHE_TTL,
    };

    return byProvider;
  }

  async getCurrentTranscriptionProviderMetadata(providerOverride?: string | null) {
    const provider = providerOverride || this.getCloudTranscriptionProvider();
    const capabilitiesByProvider = await this.loadTranscriptionProviderCapabilities();
    return capabilitiesByProvider[provider] || null;
  }

  async getCurrentTranscriptionProviderCapabilities() {
    const provider = this.getCloudTranscriptionProvider();
    const metadata = await this.getCurrentTranscriptionProviderMetadata(provider);
    return metadata?.capabilities || null;
  }

  hasBrowserStreamingCaptureSupport() {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
      if (!getAudioContextConstructor()) return false;
      return true;
    } catch {
      return false;
    }
  }

  async shouldUseVolcengineStreaming() {
    try {
      const provider = this.getCloudTranscriptionProvider();
      if (provider !== "volcengine") return false;
      const capabilities = await this.getCurrentTranscriptionProviderCapabilities();
      if (capabilities?.supports_streaming !== true) return false;
      if (!this.hasBrowserStreamingCaptureSupport()) return false;
      return (
        typeof this.platform.transcription.volcengine.startStreaming === "function" &&
        typeof this.platform.transcription.volcengine.sendAudio === "function" &&
        typeof this.platform.transcription.volcengine.finish === "function" &&
        typeof this.platform.transcription.volcengine.cancel === "function"
      );
    } catch {
      return false;
    }
  }

  async shouldUseOpenAIRealtimeStreaming() {
    try {
      const provider = this.getCloudTranscriptionProvider();
      if (provider !== "openai") return false;
      const capabilities = await this.getCurrentTranscriptionProviderCapabilities();
      if (capabilities?.supports_realtime !== true) return false;
      if (this.getTranscriptionModel() !== OPENAI_REALTIME_MODEL) return false;
      if (!this.hasBrowserStreamingCaptureSupport()) return false;
      return (
        typeof this.platform.transcription.openAIRealtime.start === "function" &&
        typeof this.platform.transcription.openAIRealtime.sendAudio === "function" &&
        typeof this.platform.transcription.openAIRealtime.finish === "function" &&
        typeof this.platform.transcription.openAIRealtime.cancel === "function"
      );
    } catch {
      return false;
    }
  }

  async getAudioConstraints() {
    const preferBuiltIn = localStorage.getItem("preferBuiltInMic") !== "false";
    const selectedDeviceId = localStorage.getItem("selectedMicDeviceId") || "";

    if (preferBuiltIn) {
      try {
        // Check if mediaDevices API is available
        if (navigator?.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = devices.filter((d) => d.kind === "audioinput");
          const builtInMic = audioInputs.find((d) => isBuiltInMicrophone(d.label));

          if (builtInMic) {
            logger.debug(
              "Using built-in microphone",
              { deviceId: builtInMic.deviceId, label: builtInMic.label },
              "audio"
            );
            return { audio: { deviceId: { exact: builtInMic.deviceId } } };
          }
        }
      } catch (error) {
        logger.debug(
          "Failed to enumerate devices for built-in mic detection",
          { error: error.message },
          "audio"
        );
      }
    }

    // Use selected device if specified and not preferring built-in
    if (!preferBuiltIn && selectedDeviceId) {
      logger.debug("Using selected microphone", { deviceId: selectedDeviceId }, "audio");
      return { audio: { deviceId: { exact: selectedDeviceId } } };
    }

    // Fall back to default device
    logger.debug("Using default microphone", {}, "audio");
    return { audio: true };
  }

  async startRecording() {
    try {
      if (
        this.isStarting ||
        this.isRecording ||
        this.isProcessing ||
        this.mediaRecorder?.state === "recording"
      ) {
        return false;
      }

      if (await this.shouldUseVolcengineStreaming()) {
        return await this.startVolcengineStreamingRecording();
      }

      if (await this.shouldUseOpenAIRealtimeStreaming()) {
        return await this.startOpenAIRealtimeRecording();
      }

      // Prefer the native recorder when the backend reports a ready platform implementation.
      if (await this.shouldUseNativeRecording()) {
        this.isStarting = true;
        this.stopRequestedDuringStart = false;

        await this.startSystemAudioDucking();
        const started = await this.platform.recording.startNative();
        if (!started) {
          await this.stopSystemAudioDucking();
          this.onError?.({
            title: "Recording Error",
            description: "Failed to start native recording.",
          });
          return false;
        }

        this.recordingStartTime = Date.now();
        this.isRecording = true;
        this.onStateChange?.({ isRecording: true, isProcessing: false });
        this.armRecordingMaxDurationTimer("native");

        // If user pressed the hotkey again while microphone was still initializing,
        // stop immediately once recording becomes active.
        if (this.stopRequestedDuringStart) {
          this.stopRequestedDuringStart = false;
          this.stopRecording();
        }

        return true;
      }

      // Check if mediaDevices API is available (may not be in Tauri WebView)
      if (!navigator?.mediaDevices?.getUserMedia) {
        this.onError?.({
          title: "Microphone Unavailable",
          description:
            "Microphone API is not available in this environment. Please restart the app.",
        });
        return false;
      }

      this.isStarting = true;
      this.stopRequestedDuringStart = false;

      const constraints = await this.getAudioConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      const preferredMimeTypes = [
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/mpeg",
        "audio/webm;codecs=opus",
        "audio/webm",
      ];

      let recorder = null;
      for (const mimeType of preferredMimeTypes) {
        try {
          if (
            typeof MediaRecorder?.isTypeSupported === "function" &&
            !MediaRecorder.isTypeSupported(mimeType)
          ) {
            continue;
          }
          recorder = new MediaRecorder(stream, { mimeType });
          break;
        } catch {
          // try next
        }
      }
      this.mediaRecorder = recorder || new MediaRecorder(stream);
      this.audioChunks = [];
      this.recordingStartTime = Date.now();
      this.recordingMimeType = this.mediaRecorder.mimeType || "audio/webm";

      this.mediaRecorder.ondataavailable = (event) => {
        if (!event?.data || event.data.size === 0) return;
        if (event.data.type) {
          this.recordingMimeType = event.data.type;
        } else if (this.mediaRecorder?.mimeType) {
          this.recordingMimeType = this.mediaRecorder.mimeType;
        }
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = async () => {
        this.clearRecordingMaxDurationTimer();
        this.isRecording = false;
        this.isProcessing = true;
        await this.stopSystemAudioDucking();
        this.onStateChange?.({ isRecording: false, isProcessing: true });

        const fallbackType =
          this.audioChunks?.[0]?.type ||
          this.mediaRecorder?.mimeType ||
          this.recordingMimeType ||
          "";
        const audioBlob = new Blob(this.audioChunks, { type: fallbackType });

        const durationSeconds = this.recordingStartTime
          ? (Date.now() - this.recordingStartTime) / 1000
          : null;
        this.recordingStartTime = null;
        await this.processAudio(audioBlob, {
          durationSeconds,
          sessionId: this.currentSessionId("renderer"),
        });

        // Clean up stream
        stream.getTracks().forEach((track) => track.stop());
      };

      await this.startSystemAudioDucking();
      this.mediaRecorder.start();
      this.isRecording = true;
      this.onStateChange?.({ isRecording: true, isProcessing: false });
      this.armRecordingMaxDurationTimer("mediarecorder");

      // If user pressed the hotkey again while microphone was still initializing,
      // stop immediately once recording becomes active.
      if (this.stopRequestedDuringStart) {
        this.stopRequestedDuringStart = false;
        this.stopRecording();
      }

      return true;
    } catch (error) {
      // Provide more specific error messages
      let errorTitle = "Recording Error";
      let errorDescription = `Failed to access microphone: ${error.message}`;

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in your system settings and try again.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorTitle = "No Microphone Found";
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        errorTitle = "Microphone In Use";
        errorDescription =
          "The microphone is being used by another application. Please close other apps and try again.";
      }

      this.onError?.({
        title: errorTitle,
        description: errorDescription,
      });
      await this.stopSystemAudioDucking();
      this.clearRecordingMaxDurationTimer();
      return false;
    } finally {
      this.isStarting = false;
      if (!this.isRecording) {
        this.stopRequestedDuringStart = false;
        this.clearRecordingMaxDurationTimer();
      }
    }
  }

  stopRecording() {
    this.clearRecordingMaxDurationTimer();

    if (this.volcStreaming && this.isRecording) {
      void this.stopVolcengineStreamingRecording();
      return true;
    }
    if (this.openAIRealtime && this.isRecording) {
      void this.stopOpenAIRealtimeRecording();
      return true;
    }
    if (this.isNativeRecordingSupported() && this.isRecording) {
      void this.stopNativeRecordingInternal();
      return true;
    }
    if (this.mediaRecorder?.state === "recording") {
      this.mediaRecorder.stop();
      // State change will be handled in onstop callback
      return true;
    }
    return false;
  }

  async stopNativeRecordingInternal() {
    if (!this.isNativeRecordingSupported()) return;
    if (this.isProcessing) return;

    this.clearRecordingMaxDurationTimer();
    this.isRecording = false;
    this.isProcessing = true;

    try {
      const result = await this.platform.recording.stopNative();
      await this.stopSystemAudioDucking();
      this.onStateChange?.({ isRecording: false, isProcessing: true });
      if (!result) {
        throw new Error("Native recorder did not return audio data");
      }

      const audioData = result.audioData;
      const mimeType = result.mimeType || "audio/wav";
      const durationSeconds =
        typeof result.durationSeconds === "number"
          ? result.durationSeconds
          : this.recordingStartTime
            ? (Date.now() - this.recordingStartTime) / 1000
            : null;

      this.recordingStartTime = null;

      if (!audioData || audioData.length === 0) {
        throw new Error("No audio detected");
      }

      const audioBytes = new Uint8Array(audioData);
      const audioBlob = new Blob([audioBytes.buffer], { type: mimeType });
      await this.processAudio(audioBlob, {
        durationSeconds,
        sessionId: this.currentSessionId("renderer"),
      });
    } catch (error) {
      await this.stopSystemAudioDucking();
      this.isProcessing = false;
      this.recordingStartTime = null;
      this.onStateChange?.({ isRecording: false, isProcessing: false });

      const message = error?.message || String(error);
      if (message === "No audio detected") {
        this.onError?.({
          title: "No Audio Detected",
          description: "The recording contained no detectable audio. Please try again.",
        });
        return;
      }

      this.onError?.({
        title: "Recording Error",
        description: `Failed to stop recording: ${message}`,
      });
    }
  }

  requestStop() {
    if (this.volcStreaming && this.isRecording) {
      return this.stopRecording();
    }
    if (this.openAIRealtime && this.isRecording) {
      return this.stopRecording();
    }
    if (this.isNativeRecordingSupported() && this.isRecording) {
      return this.stopRecording();
    }
    if (this.mediaRecorder?.state === "recording") {
      return this.stopRecording();
    }
    if (this.isStarting) {
      this.stopRequestedDuringStart = true;
      return true;
    }
    return false;
  }

  cancelRecording() {
    this.clearRecordingMaxDurationTimer();

    if (this.volcStreaming && (this.isRecording || this.isStarting)) {
      void this.cancelVolcengineStreamingRecording();
      return true;
    }
    if (this.openAIRealtime && (this.isRecording || this.isStarting)) {
      void this.cancelOpenAIRealtimeRecording();
      return true;
    }
    if (this.isNativeRecordingSupported() && (this.isRecording || this.isStarting)) {
      void this.cancelNativeRecordingInternal();
      return true;
    }
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.onstop = async () => {
        await this.stopSystemAudioDucking();
        this.isRecording = false;
        this.isProcessing = false;
        this.audioChunks = [];
        this.recordingStartTime = null;
        this.onStateChange?.({ isRecording: false, isProcessing: false });
      };

      this.mediaRecorder.stop();

      if (this.mediaRecorder.stream) {
        this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      }

      return true;
    }
    this.stopRequestedDuringStart = false;
    return false;
  }

  async cancelNativeRecordingInternal() {
    if (!this.isNativeRecordingSupported()) return;
    try {
      await this.platform.recording.cancelNative();
    } catch {
      // ignore
    }
    this.clearRecordingMaxDurationTimer();
    await this.stopSystemAudioDucking();

    this.isRecording = false;
    this.isProcessing = false;
    this.isStarting = false;
    this.audioChunks = [];
    this.recordingStartTime = null;
    this.stopRequestedDuringStart = false;
    this.onStateChange?.({ isRecording: false, isProcessing: false });
  }

  async startVolcengineStreamingRecording() {
    let stream = null;
    let sessionId = null;
    /** @type {PlatformUnlisten | null} */
    let partialUnlisten = null;

    try {
      this.isStarting = true;
      this.stopRequestedDuringStart = false;
      this.volcStreamingSendFailed = false;
      this.volcStreamingSendChain = Promise.resolve();

      const appId = await this.readSecretCredential("VOLCENGINE_APP_ID");
      const accessToken = await this.readSecretCredential("VOLCENGINE_ACCESS_TOKEN");
      const resourceId = "volc.seedasr.sauc.duration";
      const model = this.getTranscriptionModel();
      const language = localStorage.getItem("preferredLanguage") || "auto";
      void syncVocabularySettingsToBackend();

      if (!accessToken.trim()) {
        throw new Error(
          "Volcengine API Key or Access Token is required. Please configure it in Settings."
        );
      }

      const constraints = await this.getAudioConstraints();
      stream = await navigator.mediaDevices.getUserMedia(constraints);

      sessionId = await this.platform.transcription.volcengine.startStreaming(
        appId,
        accessToken,
        resourceId,
        model,
        language || undefined
      );

      partialUnlisten =
        typeof this.platform.transcription.onTranscriptEvent === "function"
          ? await resolvePlatformUnlisten(
              this.platform.transcription.onTranscriptEvent((payload) => {
                const text = String(payload?.text || "").trim();
                if (
                  !text ||
                  payload?.provider !== "volcengine" ||
                  payload?.mode !== "streaming" ||
                  payload?.sessionId !== sessionId ||
                  this.volcStreaming?.sessionId !== sessionId
                ) {
                  return;
                }
                this.volcStreaming.latestTranscript = text;
                this.volcStreaming.latestTranscriptAt = Date.now();
                this.volcStreaming.latestTranscriptIsFinal = !!payload.isFinal;
                this.onLiveTranscript?.({
                  provider: "volcengine",
                  text,
                  isFinal: !!payload.isFinal,
                  audioMs: payload.audioMs ?? null,
                  definite: !!payload.definite,
                });
              })
            )
          : null;

      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) {
        throw new Error("AudioContext is not available in this environment");
      }
      const audioContext = new AudioContextCtor();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;

      this.volcStreaming = {
        active: true,
        allChunks: [],
        appId,
        audioContext,
        accessToken,
        language,
        model,
        muteGain,
        pcmSamples: [],
        processor,
        resampleCarrySample: null,
        resamplePosition: 0,
        resourceId,
        sessionId,
        partialUnlisten,
        latestTranscript: "",
        latestTranscriptAt: null,
        latestTranscriptIsFinal: false,
        source,
        startedAt: Date.now(),
        stream,
        lastLevelAt: 0,
      };

      processor.onaudioprocess = (event) => {
        const state = this.volcStreaming;
        if (!state?.active) return;
        const input = event.inputBuffer.getChannelData(0);
        this.handleVolcengineAudioFrame(input, audioContext.sampleRate);
      };

      this.recordingStartTime = Date.now();
      await this.startSystemAudioDucking();
      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(audioContext.destination);
      this.isRecording = true;
      this.onStateChange?.({ isRecording: true, isProcessing: false });
      this.armRecordingMaxDurationTimer("volcengine-streaming");

      logger.info(
        "Volcengine streaming recording started",
        {
          audioContextSampleRate: audioContext.sampleRate,
          model,
        },
        "transcription"
      );

      if (this.stopRequestedDuringStart) {
        this.stopRequestedDuringStart = false;
        this.stopRecording();
      }

      return true;
    } catch (error) {
      if (sessionId) {
        try {
          await this.platform.transcription.volcengine.cancel(sessionId);
        } catch {
          // ignore cleanup errors
        }
      }
      callPlatformUnlisten(partialUnlisten);
      stream?.getTracks?.().forEach((track) => track.stop());
      this.volcStreaming = null;
      this.clearRecordingMaxDurationTimer();
      await this.stopSystemAudioDucking();
      this.onError?.({
        title: "Recording Error",
        description: `Failed to start Volcengine streaming recording: ${error.message}`,
      });
      return false;
    } finally {
      this.isStarting = false;
      if (!this.isRecording) {
        this.stopRequestedDuringStart = false;
        this.clearRecordingMaxDurationTimer();
      }
    }
  }

  handleVolcengineAudioFrame(input, inputSampleRate) {
    const state = this.volcStreaming;
    if (!state?.active || !input?.length) return;

    const now = performance.now();
    if (!state.lastLevelAt || now - state.lastLevelAt > 50) {
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * input[i];
      }
      const rms = Math.sqrt(sum / input.length);
      const level = Math.max(0, Math.min(1, rms * 6));
      state.lastLevelAt = now;
      this.onAudioLevel?.(level);
    }

    const ratio = inputSampleRate / STREAMING_PCM_SAMPLE_RATE;
    let samples = input;

    if (state.resampleCarrySample !== null) {
      samples = new Float32Array(input.length + 1);
      samples[0] = state.resampleCarrySample;
      samples.set(input, 1);
    }

    let position = state.resamplePosition || 0;
    while (position < samples.length - 1) {
      const index = Math.floor(position);
      const fraction = position - index;
      const current = samples[index] || 0;
      const next = samples[index + 1] || current;
      this.emitVolcenginePcmSample(current + (next - current) * fraction);
      position += ratio;
    }

    state.resamplePosition = position - (samples.length - 1);
    state.resampleCarrySample = samples[samples.length - 1] || 0;
  }

  emitVolcenginePcmSample(sample) {
    const state = this.volcStreaming;
    if (!state?.active) return;

    const clamped = Math.max(-1, Math.min(1, sample));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    state.pcmSamples.push(Math.round(int16));

    while (state.pcmSamples.length >= STREAMING_PCM_SAMPLES_PER_CHUNK) {
      const samples = state.pcmSamples.splice(0, STREAMING_PCM_SAMPLES_PER_CHUNK);
      this.queueVolcenginePcmChunk(this.pcmSamplesToBytes(samples));
    }
  }

  flushVolcenginePendingSamples() {
    const state = this.volcStreaming;
    if (!state?.pcmSamples?.length) return;

    const samples = state.pcmSamples.splice(0, state.pcmSamples.length);
    this.queueVolcenginePcmChunk(this.pcmSamplesToBytes(samples), true);
  }

  pcmSamplesToBytes(samples) {
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) {
      view.setInt16(i * 2, samples[i], true);
    }
    return bytes;
  }

  queueVolcenginePcmChunk(chunk, force = false) {
    const state = this.volcStreaming;
    if ((!state?.active && !force) || !chunk?.length) return;

    const sessionId = state.sessionId;
    const chunkCopy = new Uint8Array(chunk);
    state.allChunks.push(chunkCopy);

    const sendTask = this.volcStreamingSendChain
      .catch(() => {})
      .then(async () => {
        if (
          !this.volcStreaming ||
          this.volcStreaming.sessionId !== sessionId ||
          this.volcStreamingSendFailed
        ) {
          return;
        }
        await this.platform.transcription.volcengine.sendAudio(sessionId, chunkCopy);
      });

    this.volcStreamingSendChain = sendTask;
    void sendTask.catch((error) => {
      this.volcStreamingSendFailed = true;
      logger.error(
        "Volcengine streaming audio send failed",
        { error: error?.message || String(error) },
        "transcription"
      );
    });
  }

  stopVolcengineAudioGraph(state = this.volcStreaming) {
    if (!state) return;
    state.active = false;
    try {
      state.processor && (state.processor.onaudioprocess = null);
      state.source?.disconnect?.();
      state.processor?.disconnect?.();
      state.muteGain?.disconnect?.();
    } catch {
      // ignore graph cleanup errors
    }
    state.stream?.getTracks?.().forEach((track) => track.stop());
    void state.audioContext?.close?.();
    this.onAudioLevel?.(0);
  }

  disposeVolcengineStreamingListener(state = this.volcStreaming) {
    try {
      callPlatformUnlisten(state?.partialUnlisten);
    } catch {
      // ignore listener cleanup errors
    }
  }

  async stopVolcengineStreamingRecording() {
    const state = this.volcStreaming;
    if (!state || this.isProcessing) return;

    const pipelineStart = performance.now();
    const timings: ProcessingTimings = {};
    const durationSeconds = state.startedAt ? (Date.now() - state.startedAt) / 1000 : null;

    this.isRecording = false;
    this.isProcessing = true;
    this.clearRecordingMaxDurationTimer();

    this.stopVolcengineAudioGraph(state);
    this.flushVolcenginePendingSamples();
    await this.stopSystemAudioDucking();
    this.onStateChange?.({ isRecording: false, isProcessing: true });

    try {
      const apiCallStart = performance.now();
      let rawText = "";
      const optimisticText = String(state.latestTranscript || "").trim();
      try {
        await this.volcStreamingSendChain;
        if (this.volcStreamingSendFailed) {
          throw new Error("Volcengine streaming audio upload failed");
        }
        rawText = await this.platform.transcription.volcengine.finish(state.sessionId);
      } catch (streamingError) {
        logger.warn(
          "Volcengine streaming failed, falling back to complete-audio transcription",
          { error: streamingError?.message || String(streamingError) },
          "transcription"
        );
        try {
          await this.platform.transcription.volcengine.cancel(state.sessionId);
        } catch {
          // finish may already have removed the session
        }
        if (optimisticText) {
          rawText = optimisticText;
        } else {
          rawText = await this.fallbackVolcengineCompleteAudioTranscription(state);
        }
      }

      timings.transcriptionProcessingDurationMs = Math.round(performance.now() - apiCallStart);
      this.onLiveTranscript?.({
        provider: "volcengine",
        text: rawText,
        isFinal: true,
        audioMs: durationSeconds ? Math.round(durationSeconds * 1000) : null,
        definite: true,
      });

      if (!rawText || !rawText.trim()) {
        throw new Error(
          "No text transcribed - audio may be too short, silent, or in an unsupported format"
        );
      }

      let text = rawText;
      let source = "volcengine";
      const reasoningStart = performance.now();
      const processed = await this.processTranscription(rawText, "volcengine");
      text = processed.text;
      timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
      source = processed.usedReasoning ? `volcengine-${processed.processingMode}` : "volcengine";

      await this.onTranscriptionComplete?.(
        this.createTranscriptionSuccessResult(text, source, timings, processed, rawText)
      );

      logger.info(
        "Volcengine streaming pipeline timing",
        {
          audioDurationMs: durationSeconds ? Math.round(durationSeconds * 1000) : null,
          outputTextLength: text.length,
          optimisticPaste: false,
          directLiveInput: false,
          roundTripDurationMs: Math.round(performance.now() - pipelineStart),
          transcriptionProcessingDurationMs: timings.transcriptionProcessingDurationMs,
          reasoningProcessingDurationMs: timings.reasoningProcessingDurationMs,
        },
        "performance"
      );
    } catch (error) {
      this.onError?.({
        title: "Transcription Error",
        description: `Transcription failed: ${error.message}`,
      });
    } finally {
      this.disposeVolcengineStreamingListener(state);
      this.volcStreaming = null;
      this.volcStreamingSendChain = Promise.resolve();
      this.volcStreamingSendFailed = false;
      this.recordingStartTime = null;
      this.clearRecordingMaxDurationTimer();
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
    }
  }

  async cancelVolcengineStreamingRecording() {
    const state = this.volcStreaming;
    if (state) {
      this.stopVolcengineAudioGraph(state);
      try {
        await this.platform.transcription.volcengine.cancel(state.sessionId);
      } catch {
        // ignore
      }
      this.disposeVolcengineStreamingListener(state);
    }

    await this.stopSystemAudioDucking();
    this.clearRecordingMaxDurationTimer();
    this.volcStreaming = null;
    this.volcStreamingSendChain = Promise.resolve();
    this.volcStreamingSendFailed = false;
    this.isRecording = false;
    this.isProcessing = false;
    this.isStarting = false;
    this.recordingStartTime = null;
    this.stopRequestedDuringStart = false;
    this.onLiveTranscript?.({ text: "", isFinal: false, provider: "volcengine" });
    this.onAudioLevel?.(0);
    this.onStateChange?.({ isRecording: false, isProcessing: false });
  }

  async startOpenAIRealtimeRecording() {
    let stream = null;
    let sessionId = null;
    /** @type {PlatformUnlisten | null} */
    let partialUnlisten = null;

    try {
      this.isStarting = true;
      this.stopRequestedDuringStart = false;
      this.openAIRealtimeSendFailed = false;
      this.openAIRealtimeSendChain = Promise.resolve();

      const apiKey = await this.getAPIKey();
      const model = OPENAI_REALTIME_MODEL;
      const language = localStorage.getItem("preferredLanguage") || "auto";
      const delay = localStorage.getItem("openaiRealtimeTranscriptionDelay") || "low";

      if (!isValidApiKey(apiKey, "openai")) {
        throw new Error("OpenAI API key not found. Please set your API key in the Control Panel.");
      }

      try {
        await this.platform.secrets.set("OPENAI_API_KEY", apiKey);
      } catch {
        // The realtime path receives the key directly; this only improves fallback behavior.
      }

      const constraints = await this.getAudioConstraints();
      stream = await navigator.mediaDevices.getUserMedia(constraints);

      sessionId = await this.platform.transcription.openAIRealtime.start(
        apiKey,
        model,
        language || undefined,
        delay
      );

      partialUnlisten =
        typeof this.platform.transcription.onTranscriptEvent === "function"
          ? await resolvePlatformUnlisten(
              this.platform.transcription.onTranscriptEvent((payload) => {
                const text = String(payload?.text || "").trim();
                if (
                  !text ||
                  payload?.provider !== "openai" ||
                  payload?.mode !== "realtime" ||
                  payload?.sessionId !== sessionId ||
                  this.openAIRealtime?.sessionId !== sessionId
                ) {
                  return;
                }
                this.openAIRealtime.latestTranscript = text;
                this.openAIRealtime.latestTranscriptAt = Date.now();
                this.openAIRealtime.latestTranscriptIsFinal = !!payload.isFinal;
                this.onLiveTranscript?.({
                  provider: "openai",
                  text,
                  delta: payload.delta ?? null,
                  isFinal: !!payload.isFinal,
                  itemId: payload.itemId ?? null,
                });
              })
            )
          : null;

      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) {
        throw new Error("AudioContext is not available in this environment");
      }
      const audioContext = new AudioContextCtor();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;

      this.openAIRealtime = {
        active: true,
        allChunks: [],
        apiKey,
        audioContext,
        delay,
        language,
        model,
        muteGain,
        pcmSamples: [],
        processor,
        resampleCarrySample: null,
        resamplePosition: 0,
        sessionId,
        partialUnlisten,
        latestTranscript: "",
        latestTranscriptAt: null,
        latestTranscriptIsFinal: false,
        source,
        startedAt: Date.now(),
        stream,
        lastLevelAt: 0,
      };

      processor.onaudioprocess = (event) => {
        const state = this.openAIRealtime;
        if (!state?.active) return;
        const input = event.inputBuffer.getChannelData(0);
        this.handleOpenAIRealtimeAudioFrame(input, audioContext.sampleRate);
      };

      this.recordingStartTime = Date.now();
      await this.startSystemAudioDucking();
      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(audioContext.destination);
      this.isRecording = true;
      this.onStateChange?.({ isRecording: true, isProcessing: false });
      this.armRecordingMaxDurationTimer("openai-realtime");

      logger.info(
        "OpenAI realtime recording started",
        {
          audioContextSampleRate: audioContext.sampleRate,
          model,
          delay,
        },
        "transcription"
      );

      if (this.stopRequestedDuringStart) {
        this.stopRequestedDuringStart = false;
        this.stopRecording();
      }

      return true;
    } catch (error) {
      if (sessionId) {
        try {
          await this.platform.transcription.openAIRealtime.cancel(sessionId);
        } catch {
          // ignore cleanup errors
        }
      }
      callPlatformUnlisten(partialUnlisten);
      stream?.getTracks?.().forEach((track) => track.stop());
      this.openAIRealtime = null;
      this.clearRecordingMaxDurationTimer();
      await this.stopSystemAudioDucking();
      this.onError?.({
        title: "Recording Error",
        description: `Failed to start OpenAI realtime recording: ${error.message}`,
      });
      return false;
    } finally {
      this.isStarting = false;
      if (!this.isRecording) {
        this.stopRequestedDuringStart = false;
        this.clearRecordingMaxDurationTimer();
      }
    }
  }

  handleOpenAIRealtimeAudioFrame(input, inputSampleRate) {
    const state = this.openAIRealtime;
    if (!state?.active || !input?.length) return;

    const now = performance.now();
    if (!state.lastLevelAt || now - state.lastLevelAt > 50) {
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * input[i];
      }
      const rms = Math.sqrt(sum / input.length);
      const level = Math.max(0, Math.min(1, rms * 6));
      state.lastLevelAt = now;
      this.onAudioLevel?.(level);
    }

    const ratio = inputSampleRate / OPENAI_REALTIME_PCM_SAMPLE_RATE;
    let samples = input;

    if (state.resampleCarrySample !== null) {
      samples = new Float32Array(input.length + 1);
      samples[0] = state.resampleCarrySample;
      samples.set(input, 1);
    }

    let position = state.resamplePosition || 0;
    while (position < samples.length - 1) {
      const index = Math.floor(position);
      const fraction = position - index;
      const current = samples[index] || 0;
      const next = samples[index + 1] || current;
      this.emitOpenAIRealtimePcmSample(current + (next - current) * fraction);
      position += ratio;
    }

    state.resamplePosition = position - (samples.length - 1);
    state.resampleCarrySample = samples[samples.length - 1] || 0;
  }

  emitOpenAIRealtimePcmSample(sample) {
    const state = this.openAIRealtime;
    if (!state?.active) return;

    const clamped = Math.max(-1, Math.min(1, sample));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    state.pcmSamples.push(Math.round(int16));

    while (state.pcmSamples.length >= OPENAI_REALTIME_PCM_SAMPLES_PER_CHUNK) {
      const samples = state.pcmSamples.splice(0, OPENAI_REALTIME_PCM_SAMPLES_PER_CHUNK);
      this.queueOpenAIRealtimePcmChunk(this.pcmSamplesToBytes(samples));
    }
  }

  flushOpenAIRealtimePendingSamples() {
    const state = this.openAIRealtime;
    if (!state?.pcmSamples?.length) return;

    const samples = state.pcmSamples.splice(0, state.pcmSamples.length);
    this.queueOpenAIRealtimePcmChunk(this.pcmSamplesToBytes(samples), true);
  }

  queueOpenAIRealtimePcmChunk(chunk, force = false) {
    const state = this.openAIRealtime;
    if ((!state?.active && !force) || !chunk?.length) return;

    const sessionId = state.sessionId;
    const chunkCopy = new Uint8Array(chunk);
    state.allChunks.push(chunkCopy);

    const sendTask = this.openAIRealtimeSendChain
      .catch(() => {})
      .then(async () => {
        if (
          !this.openAIRealtime ||
          this.openAIRealtime.sessionId !== sessionId ||
          this.openAIRealtimeSendFailed
        ) {
          return;
        }
        await this.platform.transcription.openAIRealtime.sendAudio(sessionId, chunkCopy);
      });

    this.openAIRealtimeSendChain = sendTask;
    void sendTask.catch((error) => {
      this.openAIRealtimeSendFailed = true;
      logger.error(
        "OpenAI realtime audio send failed",
        { error: error?.message || String(error) },
        "transcription"
      );
    });
  }

  stopOpenAIRealtimeAudioGraph(state = this.openAIRealtime) {
    if (!state) return;
    state.active = false;
    try {
      state.processor && (state.processor.onaudioprocess = null);
      state.source?.disconnect?.();
      state.processor?.disconnect?.();
      state.muteGain?.disconnect?.();
    } catch {
      // ignore graph cleanup errors
    }
    state.stream?.getTracks?.().forEach((track) => track.stop());
    void state.audioContext?.close?.();
    this.onAudioLevel?.(0);
  }

  disposeOpenAIRealtimeListener(state = this.openAIRealtime) {
    try {
      callPlatformUnlisten(state?.partialUnlisten);
    } catch {
      // ignore listener cleanup errors
    }
  }

  async stopOpenAIRealtimeRecording() {
    const state = this.openAIRealtime;
    if (!state || this.isProcessing) return;

    const pipelineStart = performance.now();
    const timings: ProcessingTimings = {};
    const durationSeconds = state.startedAt ? (Date.now() - state.startedAt) / 1000 : null;

    this.isRecording = false;
    this.isProcessing = true;
    this.clearRecordingMaxDurationTimer();

    this.stopOpenAIRealtimeAudioGraph(state);
    this.flushOpenAIRealtimePendingSamples();
    await this.stopSystemAudioDucking();
    this.onStateChange?.({ isRecording: false, isProcessing: true });

    try {
      const apiCallStart = performance.now();
      let rawText = "";
      const optimisticText = String(state.latestTranscript || "").trim();
      try {
        await this.openAIRealtimeSendChain;
        if (this.openAIRealtimeSendFailed) {
          throw new Error("OpenAI realtime audio upload failed");
        }
        rawText = await this.platform.transcription.openAIRealtime.finish(state.sessionId);
      } catch (streamingError) {
        logger.warn(
          "OpenAI realtime failed, falling back to complete-audio transcription",
          { error: streamingError?.message || String(streamingError) },
          "transcription"
        );
        try {
          await this.platform.transcription.openAIRealtime.cancel(state.sessionId);
        } catch {
          // finish may already have removed the session
        }
        if (optimisticText) {
          rawText = optimisticText;
        } else {
          rawText = await this.fallbackOpenAIRealtimeCompleteAudioTranscription(state);
        }
      }

      timings.transcriptionProcessingDurationMs = Math.round(performance.now() - apiCallStart);
      this.onLiveTranscript?.({
        provider: "openai",
        text: rawText,
        isFinal: true,
      });

      if (!rawText || !rawText.trim()) {
        throw new Error(
          "No text transcribed - audio may be too short, silent, or in an unsupported format"
        );
      }

      const reasoningStart = performance.now();
      const processed = await this.processTranscription(rawText, "openai");
      const text = processed.text;
      timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);

      const source = processed.usedReasoning
        ? `openai-realtime-${processed.processingMode}`
        : "openai-realtime";

      await this.onTranscriptionComplete?.(
        this.createTranscriptionSuccessResult(text, source, timings, processed, rawText)
      );

      logger.info(
        "OpenAI realtime pipeline timing",
        {
          audioDurationMs: durationSeconds ? Math.round(durationSeconds * 1000) : null,
          outputTextLength: text.length,
          roundTripDurationMs: Math.round(performance.now() - pipelineStart),
          transcriptionProcessingDurationMs: timings.transcriptionProcessingDurationMs,
          reasoningProcessingDurationMs: timings.reasoningProcessingDurationMs,
        },
        "performance"
      );
    } catch (error) {
      this.onError?.({
        title: "Transcription Error",
        description: `Transcription failed: ${error.message}`,
      });
    } finally {
      this.disposeOpenAIRealtimeListener(state);
      this.openAIRealtime = null;
      this.openAIRealtimeSendChain = Promise.resolve();
      this.openAIRealtimeSendFailed = false;
      this.recordingStartTime = null;
      this.clearRecordingMaxDurationTimer();
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
    }
  }

  async cancelOpenAIRealtimeRecording() {
    const state = this.openAIRealtime;
    if (state) {
      this.stopOpenAIRealtimeAudioGraph(state);
      try {
        await this.platform.transcription.openAIRealtime.cancel(state.sessionId);
      } catch {
        // ignore
      }
      this.disposeOpenAIRealtimeListener(state);
    }

    await this.stopSystemAudioDucking();
    this.clearRecordingMaxDurationTimer();
    this.openAIRealtime = null;
    this.openAIRealtimeSendChain = Promise.resolve();
    this.openAIRealtimeSendFailed = false;
    this.isRecording = false;
    this.isProcessing = false;
    this.isStarting = false;
    this.recordingStartTime = null;
    this.stopRequestedDuringStart = false;
    this.onLiveTranscript?.({ text: "", isFinal: false, provider: "openai" });
    this.onAudioLevel?.(0);
    this.onStateChange?.({ isRecording: false, isProcessing: false });
  }

  async fallbackOpenAIRealtimeCompleteAudioTranscription(state) {
    if (!state?.allChunks?.length) {
      throw new Error("No audio detected");
    }

    const wavBlob = this.pcmChunksToWavBlob(state.allChunks, OPENAI_REALTIME_PCM_SAMPLE_RATE);
    const formData = new FormData();
    formData.append("file", wavBlob, "audio.wav");
    formData.append("model", OPENAI_REALTIME_FALLBACK_MODEL);
    if (state.language && state.language !== "auto") {
      formData.append("language", state.language);
    }

    const response = await fetch(this.getTranscriptionEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI fallback API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    return result?.text || "";
  }

  async fallbackVolcengineCompleteAudioTranscription(state) {
    if (!state?.allChunks?.length) {
      throw new Error("No audio detected");
    }

    try {
      await this.platform.secrets.set("VOLCENGINE_APP_ID", state.appId);
      await this.platform.secrets.set("VOLCENGINE_ACCESS_TOKEN", state.accessToken);
    } catch {
      // The direct streaming path already used the credentials. This only improves fallback.
    }

    const wavBlob = this.pcmChunksToWavBlob(state.allChunks);
    return VolcengineASRService.transcribe(
      wavBlob,
      {
        appId: state.appId,
        accessToken: state.accessToken,
        resourceId: state.resourceId,
      },
      {
        language: state.language || undefined,
        model: state.model,
        sessionId: state.sessionId || undefined,
      }
    );
  }

  pcmChunksToWavBlob(chunks, sampleRate = STREAMING_PCM_SAMPLE_RATE) {
    const dataLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    let offset = 0;

    const writeString = (value) => {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
      offset += value.length;
    };

    writeString("RIFF");
    view.setUint32(offset, 36 + dataLength, true);
    offset += 4;
    writeString("WAVE");
    writeString("fmt ");
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint32(offset, sampleRate, true);
    offset += 4;
    view.setUint32(offset, sampleRate * 2, true);
    offset += 4;
    view.setUint16(offset, 2, true);
    offset += 2;
    view.setUint16(offset, 16, true);
    offset += 2;
    writeString("data");
    view.setUint32(offset, dataLength, true);
    offset += 4;

    const bytes = new Uint8Array(buffer);
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  async startSystemAudioDucking() {
    if (this.audioDuckingActive) return;
    try {
      if (localStorage.getItem("muteSystemAudioWhileRecording") === "false") {
        return;
      }
    } catch {
      // Keep the backend default when localStorage is unavailable.
    }

    await sleep(RECORDING_FEEDBACK_MUTE_DELAY_MS);

    const generation = ++this.audioDuckingGeneration;
    const enabled = await this.platform.recording.startAudioDucking();
    if (!enabled || this.audioDuckingGeneration !== generation) return;

    this.audioDuckingActive = true;
  }

  async stopSystemAudioDucking() {
    if (this.audioDuckingRefreshTimer) {
      window.clearInterval(this.audioDuckingRefreshTimer);
      this.audioDuckingRefreshTimer = null;
    }

    const generation = ++this.audioDuckingGeneration;
    this.audioDuckingActive = false;
    await this.platform.recording.stopAudioDucking();
    window.setTimeout(() => {
      if (!this.audioDuckingActive && this.audioDuckingGeneration === generation) {
        void this.platform.recording.stopAudioDucking();
      }
    }, 1200);
  }

  ensureProcessingActive(timeoutContext) {
    if (timeoutContext?.hasTimedOut?.()) {
      throw new Error(PROCESSING_TIMEOUT_MESSAGE);
    }
  }

  getAudioQualitySettings() {
    const readBoolean = (key, fallback) => {
      try {
        const value = localStorage.getItem(key);
        if (value === null) return fallback;
        return value === "true";
      } catch {
        return fallback;
      }
    };

    const readSeconds = (key, fallback) => {
      try {
        const raw = localStorage.getItem(key);
        const parsed = Number.parseInt(raw || "", 10);
        if (!Number.isFinite(parsed)) return fallback;
        if (parsed <= 0) return 0;
        return Math.min(
          RECORDING_MAX_DURATION_MAX_SECONDS,
          Math.max(RECORDING_MAX_DURATION_MIN_SECONDS, parsed)
        );
      } catch {
        return fallback;
      }
    };

    const readMilliseconds = (key, fallback) => {
      try {
        const raw = localStorage.getItem(key);
        const parsed = Number.parseInt(raw || "", 10);
        if (!Number.isFinite(parsed)) return fallback;
        if (parsed <= 0) return 0;
        return Math.min(
          AUDIO_QUALITY_PRE_ROLL_MAX_MS,
          Math.max(AUDIO_QUALITY_PRE_ROLL_MIN_MS, parsed)
        );
      } catch {
        return fallback;
      }
    };

    return {
      processingEnabled: readBoolean("audioQualityProcessingEnabled", true),
      noiseGateEnabled: readBoolean("audioQualityNoiseGateEnabled", false),
      preRollMs: readMilliseconds("audioQualityPreRollMs", AUDIO_QUALITY_PRE_ROLL_DEFAULT_MS),
      maxDurationSeconds: readSeconds(
        "recordingMaxDurationSeconds",
        RECORDING_MAX_DURATION_DEFAULT_SECONDS
      ),
    };
  }

  clearRecordingMaxDurationTimer() {
    if (this.recordingMaxDurationTimer) {
      window.clearTimeout(this.recordingMaxDurationTimer);
      this.recordingMaxDurationTimer = null;
    }
  }

  armRecordingMaxDurationTimer(mode) {
    this.clearRecordingMaxDurationTimer();

    const { maxDurationSeconds } = this.getAudioQualitySettings();
    if (!maxDurationSeconds || maxDurationSeconds <= 0) return;

    this.recordingMaxDurationTimer = window.setTimeout(() => {
      this.recordingMaxDurationTimer = null;
      if (!this.isRecording || this.isProcessing) return;

      logger.info(
        "Maximum recording duration reached; stopping recording",
        { mode, maxDurationSeconds },
        "audio"
      );
      this.requestStop();
    }, maxDurationSeconds * 1000);
  }

  shouldAllowAudioQualityContainerRewrite(audioBlob, provider, model) {
    const mimeType = (audioBlob?.type || "").toLowerCase();
    if (mimeType.includes("wav")) return true;
    if (provider === "zai" || provider === "assemblyai" || provider === "volcengine") return true;
    if (provider === "groq") return true;
    if (provider === "openai" && !model.includes("gpt-4o")) return true;
    return false;
  }

  mixAudioBufferToMono(audioBuffer) {
    const length = audioBuffer.length;
    const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1);
    const mono = new Float32Array(length);

    for (let channel = 0; channel < channelCount; channel++) {
      const data = audioBuffer.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        mono[index] += data[index] / channelCount;
      }
    }

    return mono;
  }

  analyzeVoiceActivity(
    samples,
    sampleRate,
    preRollSeconds = AUDIO_QUALITY_PRE_ROLL_DEFAULT_MS / 1000
  ) {
    const frameSize = Math.max(1, Math.floor(sampleRate * AUDIO_QUALITY_FRAME_SECONDS));
    const frameCount = Math.ceil(samples.length / frameSize);
    const rmsValues = [];
    let maxRms = 0;

    for (let frame = 0; frame < frameCount; frame++) {
      const start = frame * frameSize;
      const end = Math.min(samples.length, start + frameSize);
      let sum = 0;
      for (let index = start; index < end; index++) {
        sum += samples[index] * samples[index];
      }
      const rms = Math.sqrt(sum / Math.max(1, end - start));
      rmsValues.push(rms);
      maxRms = Math.max(maxRms, rms);
    }

    if (maxRms < AUDIO_QUALITY_SILENCE_FLOOR) {
      return { isSilent: true, maxRms, threshold: AUDIO_QUALITY_SILENCE_FLOOR };
    }

    const sorted = [...rmsValues].sort((a, b) => a - b);
    const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0;
    const threshold = Math.max(
      AUDIO_QUALITY_BASE_ACTIVITY_THRESHOLD,
      noiseFloor * 2.5,
      maxRms * 0.06
    );

    let firstActiveFrame = -1;
    let lastActiveFrame = -1;
    for (let frame = 0; frame < rmsValues.length; frame++) {
      if (rmsValues[frame] >= threshold) {
        if (firstActiveFrame === -1) firstActiveFrame = frame;
        lastActiveFrame = frame;
      }
    }

    if (firstActiveFrame === -1 || lastActiveFrame === -1) {
      return { isSilent: true, maxRms, noiseFloor, threshold };
    }

    const leadingPaddingSeconds = Math.max(AUDIO_QUALITY_TRIM_PADDING_SECONDS, preRollSeconds || 0);
    const leadingPaddingSamples = Math.floor(sampleRate * leadingPaddingSeconds);
    const paddingSamples = Math.floor(sampleRate * AUDIO_QUALITY_TRIM_PADDING_SECONDS);
    const minOutputSamples = Math.floor(sampleRate * AUDIO_QUALITY_MIN_OUTPUT_SECONDS);
    let startSample = Math.max(0, firstActiveFrame * frameSize - leadingPaddingSamples);
    let endSample = Math.min(samples.length, (lastActiveFrame + 1) * frameSize + paddingSamples);

    if (endSample - startSample < minOutputSamples) {
      const center = Math.floor((startSample + endSample) / 2);
      startSample = Math.max(0, center - Math.floor(minOutputSamples / 2));
      endSample = Math.min(samples.length, startSample + minOutputSamples);
      startSample = Math.max(0, endSample - minOutputSamples);
    }

    return {
      isSilent: false,
      startSample,
      endSample,
      originalSamples: samples.length,
      maxRms,
      noiseFloor,
      threshold,
      gateThreshold: Math.max(AUDIO_QUALITY_GATE_FLOOR, noiseFloor * 2, maxRms * 0.035),
    };
  }

  applyNoiseGate(samples, sampleRate, threshold) {
    const frameSize = Math.max(1, Math.floor(sampleRate * AUDIO_QUALITY_FRAME_SECONDS));
    const output = new Float32Array(samples.length);

    for (let start = 0; start < samples.length; start += frameSize) {
      const end = Math.min(samples.length, start + frameSize);
      let sum = 0;
      for (let index = start; index < end; index++) {
        sum += samples[index] * samples[index];
      }
      const rms = Math.sqrt(sum / Math.max(1, end - start));
      const gain = rms < threshold ? 0 : 1;
      for (let index = start; index < end; index++) {
        output[index] = samples[index] * gain;
      }
    }

    return output;
  }

  resampleMonoSamples(samples, inputSampleRate, outputSampleRate) {
    if (!samples.length || inputSampleRate === outputSampleRate) {
      return samples;
    }

    const outputLength = Math.max(
      1,
      Math.round((samples.length * outputSampleRate) / inputSampleRate)
    );
    const output = new Float32Array(outputLength);
    const ratio = inputSampleRate / outputSampleRate;

    for (let index = 0; index < outputLength; index++) {
      const position = index * ratio;
      const sourceIndex = Math.floor(position);
      const fraction = position - sourceIndex;
      const current = samples[sourceIndex] ?? samples[samples.length - 1] ?? 0;
      const next = samples[sourceIndex + 1] ?? current;
      output[index] = current + (next - current) * fraction;
    }

    return output;
  }

  monoSamplesToWavBlob(samples, sampleRate) {
    const arrayBuffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(arrayBuffer);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let index = 0; index < samples.length; index++) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  async prepareAudioForTranscription(
    audioBlob: Blob,
    metadata: AudioProcessingMetadata = {},
    timeoutContext: ProcessingTimeoutContext | null = null,
    options: PrepareAudioOptions = {}
  ) {
    const settings = this.getAudioQualitySettings();
    if (!settings.processingEnabled || !options.allowContainerRewrite) {
      return { audioBlob, metadata };
    }

    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor || !audioBlob?.size) {
      return { audioBlob, metadata };
    }

    const startedAt = performance.now();
    let audioContext = null;

    try {
      this.ensureProcessingActive(timeoutContext);
      const arrayBuffer = await audioBlob.arrayBuffer();
      audioContext = new AudioContextCtor();
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      this.ensureProcessingActive(timeoutContext);

      const mono = this.mixAudioBufferToMono(decoded);
      const analysis = this.analyzeVoiceActivity(
        mono,
        decoded.sampleRate,
        settings.preRollMs / 1000
      );
      if (analysis.isSilent) {
        throw new Error("No audio detected");
      }

      let processed = mono.slice(analysis.startSample, analysis.endSample);
      if (settings.noiseGateEnabled) {
        processed = this.applyNoiseGate(processed, decoded.sampleRate, analysis.gateThreshold);
      }

      const resampled = this.resampleMonoSamples(
        processed,
        decoded.sampleRate,
        AUDIO_QUALITY_OUTPUT_SAMPLE_RATE
      );
      const preparedBlob = this.monoSamplesToWavBlob(resampled, AUDIO_QUALITY_OUTPUT_SAMPLE_RATE);
      const preparedDurationSeconds = resampled.length / AUDIO_QUALITY_OUTPUT_SAMPLE_RATE;
      const qualityProcessingDurationMs = Math.round(performance.now() - startedAt);

      logger.info(
        "Audio quality preprocessing complete",
        {
          originalSize: audioBlob.size,
          preparedSize: preparedBlob.size,
          originalDurationSeconds: decoded.duration,
          preparedDurationSeconds,
          trimmedStartMs: Math.round((analysis.startSample / decoded.sampleRate) * 1000),
          trimmedEndMs: Math.round(
            ((analysis.originalSamples - analysis.endSample) / decoded.sampleRate) * 1000
          ),
          noiseGateEnabled: settings.noiseGateEnabled,
          preRollMs: settings.preRollMs,
          qualityProcessingDurationMs,
        },
        "audio"
      );

      return {
        audioBlob: preparedBlob,
        metadata: {
          ...metadata,
          durationSeconds: preparedDurationSeconds,
          audioQuality: {
            processed: true,
            noiseGateEnabled: settings.noiseGateEnabled,
            preRollMs: settings.preRollMs,
            processingDurationMs: qualityProcessingDurationMs,
          },
        },
      };
    } catch (error) {
      if (error?.message === "No audio detected") {
        throw error;
      }

      logger.warn(
        "Audio quality preprocessing skipped",
        { error: error?.message || String(error), blobType: audioBlob?.type || "unknown" },
        "audio"
      );
      return { audioBlob, metadata };
    } finally {
      try {
        await audioContext?.close?.();
      } catch {
        // ignore
      }
    }
  }

  createTranscriptionSuccessResult(
    text: string,
    source: string,
    timings: ProcessingTimings,
    processed: any,
    rawText?: string
  ): AudioManagerTranscriptionResult {
    return {
      success: true,
      text,
      rawText: rawText ?? text,
      normalizedText: processed?.normalizedText || null,
      source,
      timings,
      postProcessingSteps: processed?.steps || [],
      postProcessingTimings: processed?.timings || null,
      processingMode: processed?.processingMode || null,
      usedReasoning: !!processed?.usedReasoning,
      fallbackReason: processed?.fallbackReason || null,
    };
  }

  async shouldUsePlatformBatchTranscription(
    provider: string,
    effectiveProvider: string,
    providerMetadata: TranscriptionProviderMetadata | null = null
  ): Promise<boolean> {
    if (provider === "custom") {
      return false;
    }
    const metadata =
      providerMetadata || (await this.getCurrentTranscriptionProviderMetadata(effectiveProvider));
    return (
      metadata?.capabilities?.supports_batch === true &&
      metadata?.supports_endpoint_override === true
    );
  }

  async syncPlatformBatchProviderCredential(provider: string): Promise<void> {
    const credentialKeys: Record<string, string> = {
      assemblyai: "ASSEMBLYAI_API_KEY",
      openai: "OPENAI_API_KEY",
      groq: "GROQ_API_KEY",
      zai: "ZAI_API_KEY",
    };
    const credentialKey = credentialKeys[provider];
    if (!credentialKey) {
      return;
    }

    const apiKey = await this.getAPIKey();
    if (!apiKey) {
      return;
    }
    try {
      await this.platform.secrets.set(credentialKey, apiKey);
    } catch {
      // The backend may already have the credential; this only migrates localStorage mirrors.
    }
  }

  async preparePlatformBatchAudioBlob(
    provider: string,
    audioBlob: Blob,
    timeoutContext: ProcessingTimeoutContext | null
  ): Promise<Blob> {
    this.ensureProcessingActive(timeoutContext);
    if (provider !== "zai") {
      return audioBlob;
    }

    const originalType = audioBlob.type || "";
    if (originalType.toLowerCase().includes("wav")) {
      return audioBlob;
    }

    let preparedAudio = await this.optimizeAudio(audioBlob);
    this.ensureProcessingActive(timeoutContext);
    if ((preparedAudio.type || "").toLowerCase().includes("wav")) {
      return preparedAudio;
    }

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      logger.warn(
        "Z.ai WAV conversion failed while app is hidden, retrying conversion once",
        {
          preparedType: preparedAudio.type || "unknown",
          originalType: originalType || "unknown",
        },
        "transcription"
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
      preparedAudio = await this.optimizeAudio(audioBlob);
      this.ensureProcessingActive(timeoutContext);
      if ((preparedAudio.type || "").toLowerCase().includes("wav")) {
        return preparedAudio;
      }
    }

    logger.warn(
      "Z.ai platform batch WAV conversion unavailable; backend may reject unsupported containers",
      {
        preparedType: preparedAudio.type || "unknown",
        originalType: originalType || "unknown",
      },
      "transcription"
    );
    return preparedAudio.size > 0 ? preparedAudio : audioBlob;
  }

  resolvePlatformBatchEndpointOverride(
    provider: string,
    effectiveProvider: string,
    endpoint: string,
    providerMetadata: TranscriptionProviderMetadata | null = null
  ): string | null {
    if (provider === "custom") {
      return null;
    }
    if (providerMetadata?.supports_endpoint_override !== true) {
      return null;
    }
    const normalizedEndpoint = typeof endpoint === "string" ? endpoint.trim() : "";
    return normalizedEndpoint || null;
  }

  async processWithPlatformBatchTranscription(
    audioBlob: Blob,
    provider: string,
    model: string,
    language: string | null,
    metadata: AudioProcessingMetadata,
    timings: ProcessingTimings,
    timeoutContext: ProcessingTimeoutContext | null,
    endpointOverride: string | null = null
  ): Promise<AudioManagerTranscriptionResult> {
    this.ensureProcessingActive(timeoutContext);
    await this.syncPlatformBatchProviderCredential(provider);
    this.ensureProcessingActive(timeoutContext);
    const uploadAudio = await this.preparePlatformBatchAudioBlob(
      provider,
      audioBlob,
      timeoutContext
    );
    this.ensureProcessingActive(timeoutContext);

    logger.debug(
      "Calling platform batch transcription",
      {
        provider,
        model,
        language: language || null,
        blobSize: uploadAudio.size,
        blobType: uploadAudio.type,
        sessionId: metadata.sessionId || null,
        hasEndpointOverride: !!endpointOverride,
      },
      "transcription"
    );

    const apiCallStart = performance.now();
    const audioData = new Uint8Array(await uploadAudio.arrayBuffer());
    this.ensureProcessingActive(timeoutContext);
    const rawText = await this.platform.transcription.transcribeAudio(
      audioData,
      provider,
      model,
      language || undefined,
      metadata.sessionId || undefined,
      endpointOverride || undefined
    );
    timings.transcriptionProcessingDurationMs = Math.round(performance.now() - apiCallStart);

    if (!rawText || !rawText.trim()) {
      throw new Error(
        "No text transcribed - audio may be too short, silent, or in an unsupported format"
      );
    }

    const reasoningStart = performance.now();
    const processed = await this.processTranscription(rawText, provider);
    const text = processed.text;
    timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);

    const source = processed.usedReasoning ? `${provider}-${processed.processingMode}` : provider;
    return this.createTranscriptionSuccessResult(text, source, timings, processed, rawText);
  }

  async processAudio(audioBlob: Blob, metadata: AudioProcessingMetadata = {}) {
    const pipelineStart = performance.now();
    const timeoutContext = createProcessingTimeoutContext();

    try {
      // Cloud-only processing
      const result = (await Promise.race([
        this.processWithOpenAIAPI(audioBlob, metadata, timeoutContext),
        timeoutContext.timeoutPromise,
      ])) as AudioManagerTranscriptionResult;

      await this.onTranscriptionComplete?.(result);

      const roundTripDurationMs = Math.round(performance.now() - pipelineStart);

      const timingData: Record<string, unknown> & {
        transcriptionProcessingDurationMs?: number | null;
      } = {
        sessionId: metadata.sessionId || null,
        mode: "cloud",
        model: this.getTranscriptionModel(),
        audioDurationMs: metadata.durationSeconds
          ? Math.round(metadata.durationSeconds * 1000)
          : null,
        reasoningProcessingDurationMs: result?.timings?.reasoningProcessingDurationMs ?? null,
        roundTripDurationMs,
        audioSizeBytes: audioBlob.size,
        audioFormat: audioBlob.type,
        outputTextLength: result?.text?.length,
      };

      timingData.transcriptionProcessingDurationMs =
        result?.timings?.transcriptionProcessingDurationMs ?? null;

      logger.info("Pipeline timing", timingData, "performance");
    } catch (error) {
      const normalizedError = timeoutContext.hasTimedOut()
        ? new Error(PROCESSING_TIMEOUT_MESSAGE)
        : error instanceof Error
          ? error
          : new Error(typeof error === "string" ? error : String(error));
      const errorAtMs = Math.round(performance.now() - pipelineStart);

      logger.error(
        "Pipeline failed",
        {
          errorAtMs,
          error: normalizedError.message,
        },
        "performance"
      );

      if (normalizedError.message === "No audio detected") {
        this.onError?.({
          title: "No Audio Detected",
          description: "The recording contained no detectable audio. Please try again.",
        });
      } else {
        this.onError?.({
          title: "Transcription Error",
          description: `Transcription failed: ${normalizedError.message}`,
        });
      }
    } finally {
      timeoutContext.dispose();
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
    }
  }

  async getAPIKey() {
    // Get the current transcription provider
    const provider =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
        : "openai";

    // Check cache (invalidate if provider changed)
    if (this.cachedApiKey !== null && this.cachedApiKeyProvider === provider) {
      return this.cachedApiKey;
    }

    let apiKey = null;

    if (provider === "custom") {
      // Custom endpoints: API key is optional
      const endpoint = this.getTranscriptionEndpoint();
      if (isAssemblyAIEndpoint(endpoint)) {
        apiKey = await this.readSecretCredential("ASSEMBLYAI_API_KEY");
        if (!isValidApiKey(apiKey, "assemblyai")) {
          apiKey = null;
        }
      } else if (isZaiEndpoint(endpoint)) {
        apiKey = await this.readSecretCredential("ZAI_API_KEY");
        if (!isValidApiKey(apiKey, "zai")) {
          apiKey = null;
        }
      } else {
        apiKey = await this.readSecretCredential("CUSTOM_TRANSCRIPTION_API_KEY");
        // For custom, allow null/empty - the endpoint may not require auth
        if (!apiKey || apiKey.trim() === "") {
          apiKey = null;
        }
      }
    } else if (provider === "volcengine") {
      // Volcengine uses appId + accessToken, not a single API key
      // Return a truthy placeholder so callers don't fail the key check
      apiKey = await this.readSecretCredential("VOLCENGINE_ACCESS_TOKEN");
      if (!apiKey || apiKey.trim() === "") {
        throw new Error("Volcengine Access Token not found. Please configure it in Settings.");
      }
    } else if (provider === "assemblyai") {
      apiKey = await this.readSecretCredential("ASSEMBLYAI_API_KEY");
      if (!isValidApiKey(apiKey, "assemblyai")) {
        throw new Error(
          "AssemblyAI API key not found. Please set your API key in the Control Panel."
        );
      }
    } else if (provider === "groq") {
      // Try to get Groq API key
      apiKey = await this.readSecretCredential("GROQ_API_KEY");
      if (!isValidApiKey(apiKey, "groq")) {
        throw new Error("Groq API key not found. Please set your API key in the Control Panel.");
      }
    } else if (provider === "zai") {
      apiKey = await this.readSecretCredential("ZAI_API_KEY");
      if (!isValidApiKey(apiKey, "zai")) {
        throw new Error("Z.ai API key not found. Please set your API key in the Control Panel.");
      }
    } else {
      // Default to OpenAI
      apiKey = await this.readSecretCredential("OPENAI_API_KEY");
      if (!isValidApiKey(apiKey, "openai")) {
        throw new Error("OpenAI API key not found. Please set your API key in the Control Panel.");
      }
    }

    this.cachedApiKey = apiKey;
    this.cachedApiKeyProvider = provider;
    return apiKey;
  }

  async optimizeAudio(audioBlob: Blob): Promise<Blob> {
    return new Promise<Blob>((resolve) => {
      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) {
        resolve(audioBlob);
        return;
      }
      const audioContext = new AudioContextCtor();
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;
          if (!(arrayBuffer instanceof ArrayBuffer)) {
            resolve(audioBlob);
            return;
          }
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Convert to 16kHz mono for smaller size and faster upload
          const sampleRate = 16000;
          const channels = 1;
          const length = Math.floor(audioBuffer.duration * sampleRate);
          const offlineContext = new OfflineAudioContext(channels, length, sampleRate);

          const source = offlineContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineContext.destination);
          source.start();

          const renderedBuffer = await offlineContext.startRendering();
          const wavBlob = this.audioBufferToWav(renderedBuffer);
          resolve(wavBlob);
        } catch {
          // If optimization fails, use original
          resolve(audioBlob);
        }
      };

      reader.onerror = () => resolve(audioBlob);
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  audioBufferToWav(buffer) {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * 2, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  getTranscriptionPrompt() {
    try {
      const prompt = localStorage.getItem("transcriptionPrompt") || "";
      return prompt.trim();
    } catch {
      return "";
    }
  }

  async waitForAssemblyAITranscription(baseUrl, transcriptId, headers, timeoutContext) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < ASSEMBLYAI_MAX_WAIT_MS) {
      this.ensureProcessingActive(timeoutContext);
      const response = await fetch(`${baseUrl}/transcript/${transcriptId}`, {
        method: "GET",
        headers,
        signal: timeoutContext?.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AssemblyAI polling failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      if (result.status === "completed") {
        return result;
      }

      if (result.status === "error") {
        throw new Error(result.error || "AssemblyAI transcription failed");
      }

      await sleep(ASSEMBLYAI_POLL_INTERVAL_MS, timeoutContext?.signal);
    }

    throw new Error("AssemblyAI transcription timed out");
  }

  async processWithAssemblyAI(
    audioBlob: Blob,
    metadata: AudioProcessingMetadata,
    timings: ProcessingTimings,
    timeoutContext: ProcessingTimeoutContext | null
  ): Promise<AudioManagerTranscriptionResult> {
    this.ensureProcessingActive(timeoutContext);
    const baseUrl = this.getTranscriptionEndpoint();
    const apiKey = await this.getAPIKey();
    const model = this.getTranscriptionModel();
    const prompt = this.getTranscriptionPrompt();
    const preferredLanguage =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("preferredLanguage") || "auto"
        : "auto";
    const speechModels = model === "universal-3-pro" ? ["universal-3-pro", "universal-2"] : [model];
    const headers = {
      authorization: apiKey,
    };

    logger.debug(
      "AssemblyAI transcription request starting",
      {
        model,
        blobSize: audioBlob.size,
        blobType: audioBlob.type,
        durationSeconds: metadata?.durationSeconds ?? null,
        hasPrompt: !!prompt,
        promptLength: prompt.length,
        preferredLanguage,
        speechModels,
        languageDetection: true,
      },
      "transcription"
    );

    const uploadStart = performance.now();
    const uploadResponse = await fetch(`${baseUrl}/upload`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
      },
      body: audioBlob,
      signal: timeoutContext?.signal,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      logger.error(
        "AssemblyAI upload failed",
        {
          status: uploadResponse.status,
          errorText,
        },
        "transcription"
      );
      throw new Error(`AssemblyAI upload failed: ${uploadResponse.status} ${errorText}`);
    }

    const uploadResult = await uploadResponse.json();
    const requestBody = {
      audio_url: uploadResult.upload_url,
      speech_models: speechModels,
      language_detection: true,
      ...(prompt && model === "universal-3-pro" ? { prompt } : {}),
    };

    logger.debug(
      "AssemblyAI transcript request prepared",
      {
        endpoint: `${baseUrl}/transcript`,
        speechModels,
        languageDetection: true,
        preferredLanguage,
        includesPrompt: !!(prompt && model === "universal-3-pro"),
      },
      "transcription"
    );

    const transcriptStart = performance.now();
    const transcriptResponse = await fetch(`${baseUrl}/transcript`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: timeoutContext?.signal,
    });

    if (!transcriptResponse.ok) {
      const errorText = await transcriptResponse.text();
      logger.error(
        "AssemblyAI transcript submission failed",
        {
          status: transcriptResponse.status,
          errorText,
          preferredLanguage,
          speechModels,
          languageDetection: true,
          includesPrompt: !!(prompt && model === "universal-3-pro"),
        },
        "transcription"
      );
      throw new Error(
        `AssemblyAI transcript submission failed: ${transcriptResponse.status} ${errorText}`
      );
    }

    const transcript = await transcriptResponse.json();
    const completedTranscript = await this.waitForAssemblyAITranscription(
      baseUrl,
      transcript.id,
      headers,
      timeoutContext
    );

    timings.transcriptionProcessingDurationMs = Math.round(
      performance.now() - Math.min(uploadStart, transcriptStart)
    );

    const reasoningStart = performance.now();
    const processed = await this.processTranscription(completedTranscript.text || "", "assemblyai");
    const text = processed.text;
    timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);

    const source = processed.usedReasoning
      ? `assemblyai-${processed.processingMode}`
      : "assemblyai";
    return this.createTranscriptionSuccessResult(
      text,
      source,
      timings,
      processed,
      completedTranscript.text || ""
    );
  }

  async processWithReasoningModel(text, model, agentName, config = {}) {
    logger.logReasoning("CALLING_REASONING_SERVICE", {
      model,
      agentName,
      textLength: text.length,
    });

    const startTime = Date.now();

    try {
      const result = await ReasoningService.processText(text, model, agentName, config);

      const processingTime = Date.now() - startTime;

      logger.logReasoning("REASONING_SERVICE_COMPLETE", {
        model,
        processingTimeMs: processingTime,
        resultLength: result.length,
        success: true,
      });

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.logReasoning("REASONING_SERVICE_ERROR", {
        model,
        processingTimeMs: processingTime,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  async isReasoningAvailable() {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const localStoredValue = localStorage.getItem("useReasoningModel");
    let backendStoredValue = null;
    try {
      backendStoredValue = await this.platform.settings.get("useReasoningModel");
    } catch {
      backendStoredValue = null;
    }
    const storedValue =
      typeof backendStoredValue === "boolean" ? String(backendStoredValue) : localStoredValue;
    const provider = localStorage.getItem("reasoningProvider") || "auto";
    const model = localStorage.getItem("reasoningModel") || "";
    const baseUrl = localStorage.getItem("cloudReasoningBaseUrl") || "";
    // Cache key should not include raw secrets.
    const [openaiKey, anthropicKey, geminiKey, groqKey, customKey, deepseekKey] = await Promise.all(
      [
        this.readSecretCredential("OPENAI_API_KEY"),
        this.readSecretCredential("ANTHROPIC_API_KEY"),
        this.readSecretCredential("GEMINI_API_KEY"),
        this.readSecretCredential("GROQ_API_KEY"),
        this.readSecretCredential("CUSTOM_REASONING_API_KEY"),
        this.readSecretCredential("DEEPSEEK_API_KEY"),
      ]
    );
    const keyPresence = {
      openai: !!openaiKey,
      anthropic: !!anthropicKey,
      gemini: !!geminiKey,
      groq: !!groqKey,
      custom: !!customKey,
      deepseek: !!deepseekKey,
    };
    const preferenceKey = JSON.stringify({ storedValue, provider, model, baseUrl, keyPresence });
    const now = Date.now();
    const cacheValid =
      this.reasoningAvailabilityCache &&
      now < this.reasoningAvailabilityCache.expiresAt &&
      this.cachedReasoningPreference === preferenceKey;

    if (cacheValid) {
      return this.reasoningAvailabilityCache.value;
    }

    logger.logReasoning("REASONING_STORAGE_CHECK", {
      storedValue,
      localStoredValue,
      backendStoredValue,
      typeOfStoredValue: typeof storedValue,
      isTrue: storedValue === "true",
      isTruthy: !!storedValue && storedValue !== "false",
    });

    // Default to enabled when not explicitly disabled.
    // Settings UI uses `useLocalStorage("useReasoningModel", true, ...)`, which may not
    // persist a value until the user toggles it.
    const useReasoning = storedValue !== "false";

    if (!useReasoning) {
      this.reasoningAvailabilityCache = {
        value: false,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = preferenceKey;
      return false;
    }

    try {
      const isAvailable = await ReasoningService.isAvailable();

      logger.logReasoning("REASONING_AVAILABILITY", {
        isAvailable,
        reasoningEnabled: useReasoning,
        finalDecision: useReasoning && isAvailable,
      });

      this.reasoningAvailabilityCache = {
        value: isAvailable,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = preferenceKey;

      return isAvailable;
    } catch (error) {
      logger.logReasoning("REASONING_AVAILABILITY_ERROR", {
        error: error.message,
        stack: error.stack,
      });

      this.reasoningAvailabilityCache = {
        value: false,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = preferenceKey;
      return false;
    }
  }

  async processTranscription(text, source) {
    return runTranscriptionPostProcessingPipeline({
      text,
      source,
      isReasoningAvailable: () => this.isReasoningAvailable(),
      processWithReasoningModel: (preparedText, model, agentName, config) =>
        this.processWithReasoningModel(preparedText, model, agentName, config),
    });
  }

  shouldStreamTranscription(model, provider) {
    // Z.ai GLM-ASR 始终启用流式转录
    if (provider === "zai") {
      return true;
    }
    if (provider !== "openai") {
      return false;
    }
    const normalized = typeof model === "string" ? model.trim() : "";
    if (!normalized || normalized === "whisper-1") {
      return false;
    }
    if (normalized === "gpt-4o-transcribe" || normalized === "gpt-4o-transcribe-diarize") {
      return true;
    }
    return normalized.startsWith("gpt-4o-mini-transcribe");
  }

  async readTranscriptionStream(response, provider = "openai") {
    const reader = response.body?.getReader();
    if (!reader) {
      logger.error("Streaming response body not available", {}, "transcription");
      throw new Error("Streaming response body not available");
    }

    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let collectedText = "";
    let finalText = null;
    let eventCount = 0;
    const eventTypes = {};
    const isZai = provider === "zai";

    const handleEvent = (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      eventCount++;
      const eventType = payload.type || "unknown";
      eventTypes[eventType] = (eventTypes[eventType] || 0) + 1;

      logger.debug(
        "Stream event received",
        {
          type: eventType,
          eventNumber: eventCount,
          payloadKeys: Object.keys(payload),
        },
        "transcription"
      );

      // OpenAI SSE 事件格式
      if (payload.type === "transcript.text.delta" && typeof payload.delta === "string") {
        collectedText += payload.delta;
        return;
      }
      if (payload.type === "transcript.text.segment" && typeof payload.text === "string") {
        collectedText += payload.text;
        return;
      }
      if (payload.type === "transcript.text.done" && typeof payload.text === "string") {
        finalText = payload.text;
        logger.debug(
          "Final transcript received",
          {
            textLength: payload.text.length,
          },
          "transcription"
        );
        return;
      }

      // Z.ai GLM-ASR SSE 事件格式兼容
      // 智谱 API 可能返回 { text: "...", ... } 或 { delta: "...", ... } 格式
      if (typeof payload.text === "string" && !payload.type) {
        collectedText += payload.text;
        return;
      }
      if (typeof payload.delta === "string" && !payload.type) {
        collectedText += payload.delta;
        return;
      }
    };

    logger.debug("Starting to read transcription stream", {}, "transcription");

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // Some servers may return the final JSON without a trailing newline (or even ignore SSE).
        // Make a best-effort pass over any remaining buffer before finalizing.
        const remaining = buffer.trim();
        if (remaining) {
          const remainingLines = remaining.split("\n");
          buffer = "";

          for (const line of remainingLines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) {
              continue;
            }

            let data = "";
            if (trimmedLine.startsWith("data: ")) {
              data = trimmedLine.slice(6);
            } else if (trimmedLine.startsWith("data:")) {
              data = trimmedLine.slice(5).trim();
            } else if (isZai && trimmedLine.startsWith("{")) {
              data = trimmedLine;
            } else {
              continue;
            }

            if (data === "[DONE]") {
              finalText = finalText ?? collectedText;
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              handleEvent(parsed);

              if (isZai && parsed.choices && Array.isArray(parsed.choices)) {
                const delta = parsed.choices[0]?.delta;
                if (delta && typeof delta.text === "string") {
                  collectedText += delta.text;
                }
                const choiceText = parsed.choices[0]?.text;
                if (typeof choiceText === "string" && !delta) {
                  collectedText += choiceText;
                }
              }
            } catch (error) {
              logger.warn(
                "Failed to parse trailing stream JSON",
                {
                  error: error?.message,
                  dataPreview: data?.substring(0, 500),
                },
                "transcription"
              );
            }
          }
        }

        logger.debug(
          "Stream reading complete",
          {
            eventCount,
            eventTypes,
            collectedTextLength: collectedText.length,
            hasFinalText: finalText !== null,
          },
          "transcription"
        );
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Log first chunk to see format
      if (eventCount === 0 && chunk.length > 0) {
        logger.debug(
          "First stream chunk received",
          {
            chunkLength: chunk.length,
            chunkPreview: chunk.substring(0, 500),
          },
          "transcription"
        );
      }

      // Process complete lines from the buffer
      // Each SSE event is "data: <json>\n" followed by empty line
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines
        if (!trimmedLine) {
          continue;
        }

        // Extract data from "data: " prefix (standard SSE format)
        let data = "";
        if (trimmedLine.startsWith("data: ")) {
          data = trimmedLine.slice(6);
        } else if (trimmedLine.startsWith("data:")) {
          data = trimmedLine.slice(5).trim();
        } else if (isZai && trimmedLine.startsWith("{")) {
          // Z.ai 可能直接返回 JSON 行，不带 data: 前缀
          data = trimmedLine;
        } else {
          continue;
        }

        // Handle [DONE] marker
        if (data === "[DONE]") {
          finalText = finalText ?? collectedText;
          continue;
        }

        // Try to parse JSON
        try {
          const parsed = JSON.parse(data);
          handleEvent(parsed);

          // Z.ai 特殊处理：可能在 choices[0].delta.text 中返回增量文本
          if (isZai && parsed.choices && Array.isArray(parsed.choices)) {
            const delta = parsed.choices[0]?.delta;
            if (delta && typeof delta.text === "string") {
              collectedText += delta.text;
            }
            // 也检查 choices[0].text 格式
            const choiceText = parsed.choices[0]?.text;
            if (typeof choiceText === "string" && !delta) {
              collectedText += choiceText;
            }
          }
        } catch (error) {
          const logFn = isZai ? logger.warn : logger.debug;
          logFn(
            "Failed to parse stream JSON",
            {
              error: error?.message,
              dataPreview: data?.substring(0, 500),
            },
            "transcription"
          );
        }
      }
    }

    const result = finalText ?? collectedText;
    logger.debug(
      "Stream processing complete",
      {
        resultLength: result.length,
        usedFinalText: finalText !== null,
        eventCount,
        eventTypes,
      },
      "transcription"
    );

    return result;
  }

  async processWithOpenAIAPI(
    audioBlob: Blob,
    metadata: AudioProcessingMetadata = {},
    timeoutContext: ProcessingTimeoutContext | null = null
  ): Promise<AudioManagerTranscriptionResult> {
    const timings: ProcessingTimings = {};
    const language = localStorage.getItem("preferredLanguage");

    try {
      this.ensureProcessingActive(timeoutContext);
      let model = this.getTranscriptionModel();
      const provider = localStorage.getItem("cloudTranscriptionProvider") || "openai";
      const platformProviderMetadata =
        provider === "custom" ? null : await this.getCurrentTranscriptionProviderMetadata(provider);
      const endpoint = this.getTranscriptionEndpoint(platformProviderMetadata);

      const effectiveProvider =
        provider === "custom" && isAssemblyAIEndpoint(endpoint)
          ? "assemblyai"
          : provider === "custom" && isZaiEndpoint(endpoint)
            ? "zai"
            : provider;

      // 调试日志：打印 provider 信息
      logger.debug(
        "Transcription provider selected",
        {
          provider,
          effectiveProvider,
          endpoint,
        },
        "transcription"
      );

      if (effectiveProvider === "zai" && !model.startsWith("glm-asr")) {
        model = "glm-asr-2512";
      }

      if (effectiveProvider === "openai" && model === OPENAI_REALTIME_MODEL) {
        logger.warn(
          "Realtime transcription model selected without realtime pipeline; falling back to file transcription model",
          { model, fallbackModel: OPENAI_REALTIME_FALLBACK_MODEL },
          "transcription"
        );
        model = OPENAI_REALTIME_FALLBACK_MODEL;
      }

      const preparedAudio = await this.prepareAudioForTranscription(
        audioBlob,
        metadata,
        timeoutContext,
        {
          allowContainerRewrite: this.shouldAllowAudioQualityContainerRewrite(
            audioBlob,
            effectiveProvider,
            model
          ),
        }
      );
      audioBlob = preparedAudio.audioBlob;
      metadata = preparedAudio.metadata;
      if (metadata.audioQuality?.processed) {
        timings.audioQualityProcessingDurationMs = metadata.audioQuality.processingDurationMs;
      }

      const durationSeconds = metadata.durationSeconds ?? null;
      const shouldSkipOptimizationForDuration =
        typeof durationSeconds === "number" &&
        durationSeconds > 0 &&
        durationSeconds < SHORT_CLIP_DURATION_SECONDS;

      // Volcengine (豆包) streaming ASR via WebSocket binary protocol
      if (
        effectiveProvider === "zai" &&
        typeof durationSeconds === "number" &&
        durationSeconds > 30
      ) {
        throw new Error(
          "Z.ai (GLM ASR) currently supports audio files up to 30 seconds. Please record a shorter clip or switch providers."
        );
      }

      if (
        await this.shouldUsePlatformBatchTranscription(
          provider,
          effectiveProvider,
          platformProviderMetadata
        )
      ) {
        const endpointOverride = this.resolvePlatformBatchEndpointOverride(
          provider,
          effectiveProvider,
          endpoint,
          platformProviderMetadata
        );
        return this.processWithPlatformBatchTranscription(
          audioBlob,
          effectiveProvider,
          model,
          language,
          metadata,
          timings,
          timeoutContext,
          endpointOverride
        );
      }

      if (effectiveProvider === "volcengine") {
        const volcAppId = await this.readSecretCredential("VOLCENGINE_APP_ID");
        const volcToken = await this.readSecretCredential("VOLCENGINE_ACCESS_TOKEN");
        const volcResource = "volc.seedasr.sauc.duration";
        logger.debug(
          "Volcengine batch transcription selected",
          {
            hasAppId: !!volcAppId,
            hasAccessToken: !!volcToken,
            resourceId: volcResource,
          },
          "transcription"
        );

        if (!volcToken) {
          throw new Error(
            "Volcengine API Key or Access Token is required. Please configure it in Settings."
          );
        }

        logger.debug(
          "Calling Volcengine ASR service",
          {
            blobSize: audioBlob.size,
            model,
            language: language || null,
          },
          "transcription"
        );

        const apiCallStart = performance.now();
        const rawText = await VolcengineASRService.transcribe(
          audioBlob,
          { appId: volcAppId, accessToken: volcToken, resourceId: volcResource },
          { language: language || undefined, model, sessionId: metadata.sessionId || undefined }
        );
        logger.debug(
          "Volcengine ASR service returned",
          { textLength: rawText?.length || 0 },
          "transcription"
        );
        timings.transcriptionProcessingDurationMs = Math.round(performance.now() - apiCallStart);

        if (!rawText || !rawText.trim()) {
          throw new Error(
            "No text transcribed - audio may be too short, silent, or in an unsupported format"
          );
        }

        const reasoningStart = performance.now();
        const processed = await this.processTranscription(rawText, "volcengine");
        const text = processed.text;
        timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);

        const source = processed.usedReasoning
          ? `volcengine-${processed.processingMode}`
          : "volcengine";
        return this.createTranscriptionSuccessResult(text, source, timings, processed, rawText);
      }

      if (effectiveProvider === "assemblyai") {
        return this.processWithAssemblyAI(audioBlob, metadata, timings, timeoutContext);
      }

      logger.debug(
        "Transcription request starting",
        {
          provider: effectiveProvider,
          model,
          blobSize: audioBlob.size,
          blobType: audioBlob.type,
          durationSeconds,
          language,
          endpoint,
        },
        "transcription"
      );

      // gpt-4o-transcribe models don't support WAV format - they need webm, mp3, mp4, etc.
      // Only use WAV optimization for whisper-1 and groq models
      const is4oModel = model.includes("gpt-4o");
      const shouldForceWav = effectiveProvider === "zai";
      const shouldOptimize =
        shouldForceWav ||
        (!is4oModel && !shouldSkipOptimizationForDuration && audioBlob.size > 1024 * 1024);

      logger.debug(
        "Audio optimization decision",
        {
          is4oModel,
          shouldOptimize,
          shouldSkipOptimizationForDuration,
        },
        "transcription"
      );

      let [apiKey, optimizedAudio] = await Promise.all([
        this.getAPIKey(),
        shouldOptimize ? this.optimizeAudio(audioBlob) : Promise.resolve(audioBlob),
      ]);
      this.ensureProcessingActive(timeoutContext);

      if (
        shouldForceWav &&
        optimizedAudio.type !== "audio/wav" &&
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        logger.warn(
          "Z.ai WAV conversion failed while app is hidden, retrying conversion once",
          {
            optimizedType: optimizedAudio.type || "unknown",
            originalType: audioBlob.type || "unknown",
          },
          "transcription"
        );
        await new Promise((resolve) => setTimeout(resolve, 120));
        optimizedAudio = await this.optimizeAudio(audioBlob);
      }

      let uploadAudio = optimizedAudio;
      if (shouldForceWav && optimizedAudio.type !== "audio/wav") {
        // In fullscreen/occluded scenarios on macOS, WebAudio decode may fail.
        // Fallback to the original container instead of failing before API call.
        uploadAudio = audioBlob.size > 0 ? audioBlob : optimizedAudio;
        logger.warn(
          "Z.ai WAV conversion unavailable, falling back to original container",
          {
            optimizedType: optimizedAudio.type || "unknown",
            fallbackType: uploadAudio.type || "unknown",
            originalType: audioBlob.type || "unknown",
            visibilityState:
              typeof document !== "undefined" ? document.visibilityState : "unavailable",
          },
          "transcription"
        );
      }

      const formData = new FormData();
      const mimeType =
        uploadAudio.type || audioBlob.type || (shouldForceWav ? "audio/wav" : "audio/webm");
      const normalizedMimeType = mimeType.toLowerCase();
      const extension = normalizedMimeType.includes("webm")
        ? "webm"
        : normalizedMimeType.includes("ogg")
          ? "ogg"
          : normalizedMimeType.includes("mp4")
            ? "mp4"
            : normalizedMimeType.includes("mpeg") || normalizedMimeType.includes("mp3")
              ? "mp3"
              : normalizedMimeType.includes("wav")
                ? "wav"
                : "webm";

      logger.debug(
        "FormData preparation",
        {
          mimeType,
          extension,
          optimizedSize: uploadAudio.size,
          hasApiKey: !!apiKey,
        },
        "transcription"
      );

      formData.append("file", uploadAudio, `audio.${extension}`);
      formData.append("model", model);

      if (effectiveProvider !== "zai" && language && language !== "auto") {
        formData.append("language", language);
      }

      const shouldStream = this.shouldStreamTranscription(model, effectiveProvider);
      if (shouldStream) {
        formData.append("stream", "true");
      }

      logger.debug(
        "Making transcription API request",
        {
          endpoint,
          shouldStream,
          model,
        },
        "transcription"
      );

      // Build headers - only include Authorization if we have an API key
      const headers = new Headers();
      if (apiKey) {
        headers.set("Authorization", `Bearer ${apiKey}`);
      }

      const apiCallStart = performance.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: formData,
        signal: timeoutContext?.signal,
      });

      const responseContentType = response.headers.get("content-type") || "";

      logger.debug(
        "Transcription API response received",
        {
          status: response.status,
          statusText: response.statusText,
          contentType: responseContentType,
          ok: response.ok,
          allHeaders:
            effectiveProvider === "zai"
              ? Object.fromEntries(response.headers.entries())
              : undefined,
        },
        "transcription"
      );

      // Z.ai 流式调试：打印到控制台以便查看
      if (effectiveProvider === "zai" && shouldStream) {
        console.log("[Z.ai Stream Debug] Content-Type:", responseContentType);
        console.log(
          "[Z.ai Stream Debug] All Headers:",
          Object.fromEntries(response.headers.entries())
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          "Transcription API error response",
          {
            status: response.status,
            errorText,
          },
          "transcription"
        );
        throw new Error(`API Error: ${response.status} ${errorText}`);
      }

      let result;
      const contentType = responseContentType;

      // 判断是否应处理为流式响应
      // Z.ai 可能不返回 text/event-stream，需要根据 shouldStream 标志直接处理
      const isStreamResponse =
        shouldStream &&
        (effectiveProvider === "zai" ||
          contentType.includes("text/event-stream") ||
          contentType.includes("application/octet-stream"));

      if (isStreamResponse) {
        logger.debug(
          "Processing streaming response",
          { contentType, effectiveProvider },
          "transcription"
        );
        const streamedText = await this.readTranscriptionStream(response, effectiveProvider);
        result = { text: streamedText };
        logger.debug(
          "Streaming response parsed",
          {
            hasText: !!streamedText,
            textLength: streamedText?.length,
          },
          "transcription"
        );
      } else {
        const rawText = await response.text();
        logger.debug(
          "Raw API response body",
          {
            rawText: rawText.substring(0, 1000),
            fullLength: rawText.length,
          },
          "transcription"
        );

        try {
          result = JSON.parse(rawText);
        } catch (parseError) {
          logger.error(
            "Failed to parse JSON response",
            {
              parseError: parseError.message,
              rawText: rawText.substring(0, 500),
            },
            "transcription"
          );
          throw new Error(`Failed to parse API response: ${parseError.message}`);
        }

        logger.debug(
          "Parsed transcription result",
          {
            hasText: !!result.text,
            textLength: result.text?.length,
            resultKeys: Object.keys(result),
            fullResult: result,
          },
          "transcription"
        );

        // Some providers (and OpenAI-compatible proxies) may nest the text.
        // Normalize to `{ text: string }` when possible.
        if ((!result.text || typeof result.text !== "string") && effectiveProvider === "zai") {
          const candidate =
            result?.data?.text ||
            result?.data?.result?.text ||
            result?.result?.text ||
            result?.data?.transcription ||
            result?.transcription;

          if (typeof candidate === "string") {
            result.text = candidate;
          }
        }
      }

      // Check for text - handle both empty string and missing field
      if (result.text && result.text.trim().length > 0) {
        timings.transcriptionProcessingDurationMs = Math.round(performance.now() - apiCallStart);

        this.ensureProcessingActive(timeoutContext);
        const reasoningStart = performance.now();
        const processed = await this.processTranscription(result.text, effectiveProvider);
        const text = processed.text;
        timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);

        const source = processed.usedReasoning
          ? `${effectiveProvider}-${processed.processingMode}`
          : effectiveProvider;
        logger.debug(
          "Transcription successful",
          {
            originalLength: result.text.length,
            processedLength: text.length,
            source,
            transcriptionProcessingDurationMs: timings.transcriptionProcessingDurationMs,
            reasoningProcessingDurationMs: timings.reasoningProcessingDurationMs,
          },
          "transcription"
        );
        return this.createTranscriptionSuccessResult(text, source, timings, processed, result.text);
      } else {
        // Log at info level so it shows without debug mode
        logger.info(
          "Transcription returned empty - check audio input",
          {
            model,
            provider,
            endpoint,
            blobSize: audioBlob.size,
            blobType: audioBlob.type,
            mimeType,
            extension,
            resultText: result.text,
            resultKeys: Object.keys(result),
          },
          "transcription"
        );
        logger.error(
          "No text in transcription result",
          {
            result,
            resultKeys: Object.keys(result),
          },
          "transcription"
        );
        throw new Error(
          "No text transcribed - audio may be too short, silent, or in an unsupported format"
        );
      }
    } catch (error) {
      // Cloud-only transcription: no local fallback.
      throw error;
    }
  }

  getTranscriptionModel() {
    try {
      const provider =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
          : "openai";

      const model =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("cloudTranscriptionModel") || ""
          : "";

      const trimmedModel = model.trim();

      // For custom provider, use whatever model is set (or fallback to whisper-1)
      if (provider === "custom") {
        return trimmedModel || "whisper-1";
      }

      // Validate model matches provider to handle settings migration
      if (trimmedModel) {
        const isAssemblyAIModel =
          trimmedModel === "universal-3-pro" || trimmedModel === "universal-2";
        const isGroqModel = trimmedModel.startsWith("whisper-large-v3");
        const isOpenAIModel =
          trimmedModel.startsWith("gpt-4o") ||
          trimmedModel === "whisper-1" ||
          trimmedModel === OPENAI_REALTIME_MODEL;
        const isZaiModel = trimmedModel.startsWith("glm-asr");

        if (provider === "assemblyai" && isAssemblyAIModel) {
          return trimmedModel;
        }
        if (provider === "groq" && isGroqModel) {
          return trimmedModel;
        }
        if (provider === "openai" && isOpenAIModel) {
          return trimmedModel;
        }
        if (provider === "zai" && isZaiModel) {
          return trimmedModel;
        }
        if (provider === "volcengine" && trimmedModel === "volcengine-bigmodel-async") {
          return trimmedModel;
        }
        // Model doesn't match provider - fall through to default
      }

      // Return provider-appropriate default
      if (provider === "assemblyai") return "universal-3-pro";
      if (provider === "groq") return "whisper-large-v3-turbo";
      if (provider === "zai") return "glm-asr-2512";
      if (provider === "volcengine") return "volcengine-bigmodel-async";
      return "gpt-4o-mini-transcribe";
    } catch {
      if (
        typeof localStorage !== "undefined" &&
        (localStorage.getItem("cloudTranscriptionProvider") || "openai") === "assemblyai"
      ) {
        return "universal-3-pro";
      }
      return "gpt-4o-mini-transcribe";
    }
  }

  getTranscriptionEndpoint(providerMetadata: TranscriptionProviderMetadata | null = null) {
    // Get current provider and base URL to check if cache is valid
    const currentProvider =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("cloudTranscriptionProvider") || "openai"
        : "openai";
    const currentBaseUrl =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("cloudTranscriptionBaseUrl") || ""
        : "";
    const providerDefaultBaseUrl =
      currentProvider === "custom"
        ? ""
        : resolveProviderDefaultBaseUrl(
            providerMetadata ||
              this.transcriptionProviderCapabilityCache?.byProvider?.[currentProvider] ||
              FALLBACK_PROVIDER_METADATA[currentProvider]
          );
    const baseFallback =
      currentProvider === "custom"
        ? API_ENDPOINTS.TRANSCRIPTION_BASE
        : providerDefaultBaseUrl || API_ENDPOINTS.TRANSCRIPTION_BASE;
    const fallbackEndpoint =
      buildTranscriptionEndpointForProvider(currentProvider, baseFallback) ||
      API_ENDPOINTS.TRANSCRIPTION;

    // Invalidate cache if provider or base URL changed
    if (
      this.cachedTranscriptionEndpoint &&
      (this.cachedEndpointProvider !== currentProvider ||
        this.cachedEndpointBaseUrl !== currentBaseUrl ||
        this.cachedEndpointDefaultBaseUrl !== providerDefaultBaseUrl)
    ) {
      this.cachedTranscriptionEndpoint = null;
    }

    if (this.cachedTranscriptionEndpoint) {
      return this.cachedTranscriptionEndpoint;
    }

    try {
      const base = currentBaseUrl.trim() || baseFallback;
      const normalizedBase = normalizeBaseUrl(base);

      const cacheResult = (endpoint) => {
        this.cachedTranscriptionEndpoint = endpoint;
        this.cachedEndpointProvider = currentProvider;
        this.cachedEndpointBaseUrl = currentBaseUrl;
        this.cachedEndpointDefaultBaseUrl = providerDefaultBaseUrl;
        return endpoint;
      };

      if (currentProvider === "custom" && isAssemblyAIEndpoint(normalizedBase || base)) {
        const assemblyaiDefaultBase = resolveProviderDefaultBaseUrl(
          FALLBACK_PROVIDER_METADATA.assemblyai
        );
        const effectiveBase = normalizedBase || assemblyaiDefaultBase;

        if (!isSecureEndpoint(effectiveBase)) {
          console.warn("HTTPS required (HTTP allowed for local network only). Using default.");
          return cacheResult(
            buildTranscriptionEndpointForProvider("assemblyai", assemblyaiDefaultBase)
          );
        }

        return cacheResult(buildTranscriptionEndpointForProvider("assemblyai", effectiveBase));
      }

      // If the user selected "Custom" but points at Z.ai, treat it like Z.ai.
      // Z.ai uses a different path and requires WAV/MP3 (handled elsewhere).
      if (currentProvider === "custom" && isZaiEndpoint(normalizedBase || base)) {
        const rawCandidate = normalizedBase || base;
        let fallbackZaiBase = resolveProviderDefaultBaseUrl(FALLBACK_PROVIDER_METADATA.zai);
        try {
          const candidateUrl = new URL(rawCandidate);
          if (/(^|\.)open\.bigmodel\.cn$/i.test(candidateUrl.hostname)) {
            fallbackZaiBase = "https://open.bigmodel.cn/api";
          }
        } catch {
          if (/\/\/open\.bigmodel\.cn\b/i.test(String(rawCandidate))) {
            fallbackZaiBase = "https://open.bigmodel.cn/api";
          }
        }
        const effectiveBase = normalizedBase || fallbackZaiBase;

        if (!isSecureEndpoint(effectiveBase)) {
          console.warn("HTTPS required (HTTP allowed for local network only). Using default.");
          return cacheResult(buildTranscriptionEndpointForProvider("zai", fallbackZaiBase));
        }

        return cacheResult(buildTranscriptionEndpointForProvider("zai", effectiveBase));
      }

      if (currentProvider === "volcengine") {
        // Volcengine is pinned to Seed ASR 2.0.
        return cacheResult(buildTranscriptionEndpointForProvider("volcengine", baseFallback));
      }

      if (currentProvider === "assemblyai") {
        const effectiveBase = normalizedBase || baseFallback;

        if (!isSecureEndpoint(effectiveBase)) {
          console.warn("HTTPS required (HTTP allowed for local network only). Using default.");
          return cacheResult(buildTranscriptionEndpointForProvider("assemblyai", baseFallback));
        }

        return cacheResult(buildTranscriptionEndpointForProvider("assemblyai", effectiveBase));
      }

      if (currentProvider === "zai") {
        const fallbackZaiBase = baseFallback;
        const effectiveBase = normalizedBase || fallbackZaiBase;

        if (!isSecureEndpoint(effectiveBase)) {
          console.warn("HTTPS required (HTTP allowed for local network only). Using default.");
          return cacheResult(buildTranscriptionEndpointForProvider("zai", fallbackZaiBase));
        }

        return cacheResult(buildTranscriptionEndpointForProvider("zai", effectiveBase));
      }

      if (!normalizedBase) {
        return cacheResult(fallbackEndpoint);
      }

      if (!isSecureEndpoint(normalizedBase)) {
        console.warn("HTTPS required (HTTP allowed for local network only). Using default.");
        return cacheResult(fallbackEndpoint);
      }

      return cacheResult(buildTranscriptionEndpointForProvider(currentProvider, normalizedBase));
    } catch (error) {
      console.warn("Failed to resolve transcription endpoint:", error);
      this.cachedTranscriptionEndpoint = fallbackEndpoint;
      this.cachedEndpointProvider = currentProvider;
      this.cachedEndpointBaseUrl = currentBaseUrl;
      this.cachedEndpointDefaultBaseUrl = providerDefaultBaseUrl;
      return fallbackEndpoint;
    }
  }

  async safePaste(text) {
    try {
      await this.platform.clipboard.pasteText(text);
      return true;
    } catch (error) {
      this.onError?.({
        title: "Insert Error",
        description: `Failed to insert text into the active field. ${error.message}`,
      });
      return false;
    }
  }

  async saveTranscription(text: string, options: SaveTranscriptionOptions = {}) {
    try {
      const provider =
        options.provider ||
        (typeof localStorage !== "undefined"
          ? localStorage.getItem("cloudTranscriptionProvider")
          : null);
      const model = options.model || this.getTranscriptionModel?.();
      const language =
        options.language ||
        (typeof localStorage !== "undefined" ? localStorage.getItem("preferredLanguage") : null);

      const saveResult = await this.platform.history.saveTranscription(
        options.rawText || text,
        options.processedText ?? text,
        options.method || "dictation",
        options.agentName || undefined,
        {
          ...options,
          provider,
          model,
          language: language === "auto" ? null : language,
        }
      );
      return saveResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** @returns {AudioManagerState} */
  getState() {
    return {
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
      isStarting: this.isStarting,
    };
  }

  cleanup() {
    if (this.volcStreaming && (this.isRecording || this.isStarting || this.isProcessing)) {
      void this.cancelVolcengineStreamingRecording();
    } else if (this.openAIRealtime && (this.isRecording || this.isStarting || this.isProcessing)) {
      void this.cancelOpenAIRealtimeRecording();
    } else if (this.isNativeRecordingSupported() && (this.isRecording || this.isStarting)) {
      void this.cancelNativeRecordingInternal();
    }
    if (this.mediaRecorder?.state === "recording") {
      this.stopRecording();
    }
    void this.stopSystemAudioDucking();
    this.stopRequestedDuringStart = false;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
  }
}

export default AudioManager;
