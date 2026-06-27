export interface TranscriptionItem {
  id: number;
  text: string;
  timestamp: string;
  created_at?: string;
  processed_text?: string | null;
  is_processed?: boolean;
  processing_method?: string;
  agent_name?: string | null;
  error?: string | null;
  session_id?: string | null;
}

export interface WhisperCheckResult {
  installed: boolean;
  working: boolean;
  error?: string;
}

export interface WhisperModelResult {
  success: boolean;
  model: string;
  downloaded: boolean;
  size_mb?: number;
  error?: string;
}

export interface WhisperModelDeleteResult {
  success: boolean;
  model: string;
  deleted: boolean;
  freed_mb?: number;
  error?: string;
}

export interface WhisperModelsListResult {
  success: boolean;
  models: Array<{ model: string; downloaded: boolean; size_mb?: number }>;
  cache_dir: string;
}

export interface FFmpegAvailabilityResult {
  available: boolean;
  path?: string;
  error?: string;
}

export interface AudioDiagnosticsResult {
  platform: string;
  arch: string;
  resourcesPath: string | null;
  isPackaged: boolean;
  ffmpeg: { available: boolean; path: string | null; error: string | null };
  whisperBinary: { available: boolean; path: string | null; error: string | null };
  whisperServer: { available: boolean; path: string | null };
  modelsDir: string;
  models: string[];
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  version?: string;
  releaseDate?: string;
  files?: any[];
  releaseNotes?: string;
  message?: string;
}

export interface UpdateStatusResult {
  updateAvailable: boolean;
  updateDownloaded: boolean;
  isDevelopment: boolean;
}

export interface UpdateInfoResult {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | null;
  files?: any[];
}

export interface UpdateResult {
  success: boolean;
  message: string;
}

export interface AppVersionResult {
  version: string;
}

export interface WhisperDownloadProgressData {
  type: string;
  model: string;
  percentage?: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  error?: string;
  result?: any;
}

export interface PasteToolsResult {
  platform: "darwin" | "win32" | "linux";
  available: boolean;
  method: string | null;
  requiresPermission: boolean;
  isWayland?: boolean;
  xwaylandAvailable?: boolean;
  tools?: string[];
  recommendedInstall?: string;
}

export interface ForegroundApplication {
  id: string;
  name: string;
  platform: string;
  processId?: number | null;
  bundleId?: string | null;
  executablePath?: string | null;
}

export interface PrivacyDiagnostics {
  detectedForeground: ForegroundApplication | null;
  activeForeground: ForegroundApplication | null;
  applicationBlacklist: string[];
  detectedCandidates: string[];
  activeCandidates: string[];
  detectedApplicationBlacklisted: boolean;
  activeApplicationBlacklisted: boolean;
  pauseHistoryInBlacklistedApps: boolean;
  pauseClipboardInBlacklistedApps: boolean;
  autoDeleteHistoryEnabled: boolean;
  historyRetentionDays: number;
  effectiveHistoryRetentionDays: number | null;
  wouldSkipTranscriptionHistory: boolean;
  wouldSkipClipboardCapture: boolean;
  detectionError: string | null;
}

export interface NativeRecordingCapabilities {
  supported: boolean;
  platform: string;
  backend: string;
  status: string;
  reason?: string | null;
  active: boolean;
}

export interface NativeRecordingResult {
  audioData: Uint8Array;
  mimeType: string;
  durationSeconds: number | null;
}
