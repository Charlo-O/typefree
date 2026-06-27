import { useState, useEffect, useCallback, useRef } from "react";
import {
  platform,
  type PlatformListenerCleanup,
  type UpdateCheckResult,
  type UpdateDownloadProgressPayload,
  type UpdateInfoResult,
  type UpdateStatusResult,
} from "../../../shared/platform";

/**
 * Centralized hook for managing app updates.
 * Prevents listener leaks by ensuring update listeners are only registered once
 * globally using a singleton pattern.
 */

type UpdateStatus = UpdateStatusResult;
type UpdateInfo = UpdateInfoResult;

interface UpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  downloadProgress: number;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  error: Error | null;
}

// Global state shared across all hook instances.
let globalState: UpdateState = {
  status: {
    updateAvailable: false,
    updateDownloaded: false,
    isDevelopment: false,
  },
  info: null,
  downloadProgress: 0,
  isChecking: false,
  isDownloading: false,
  isInstalling: false,
  error: null,
};

const stateListeners = new Set<(state: UpdateState) => void>();
let listenersRegistered = false;
const cleanupFunctions: Array<() => void> = [];

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function bindCleanup(result: PlatformListenerCleanup) {
  if (!result) return;
  if (typeof result === "function") {
    cleanupFunctions.push(result);
    return;
  }

  result
    .then((dispose) => {
      if (typeof dispose === "function") {
        cleanupFunctions.push(dispose);
      }
    })
    .catch((error) => {
      console.warn("Failed to register updater listener:", error);
    });
}

function notifyListeners() {
  stateListeners.forEach((listener) => listener({ ...globalState }));
}

function updateGlobalState(updates: Partial<UpdateState>) {
  globalState = { ...globalState, ...updates };
  notifyListeners();
}

function updateInfoFromCheckResult(result: UpdateCheckResult): UpdateInfo | null {
  if (!result.updateAvailable) return null;
  return {
    version: result.version,
    releaseDate: result.releaseDate,
    releaseNotes: result.releaseNotes ?? null,
    files: result.files,
  };
}

function normalizeProgress(payload: UpdateDownloadProgressPayload): number {
  const percent = Number.isFinite(payload.percent) ? payload.percent : 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function registerEventListeners() {
  if (listenersRegistered) {
    return;
  }

  listenersRegistered = true;

  bindCleanup(
    platform.updater.onAvailable((info) => {
      updateGlobalState({
        status: { ...globalState.status, updateAvailable: true },
        info: info || globalState.info,
        isChecking: false,
      });
    })
  );

  bindCleanup(
    platform.updater.onNotAvailable(() => {
      updateGlobalState({
        status: {
          ...globalState.status,
          updateAvailable: false,
          updateDownloaded: false,
        },
        info: null,
        isChecking: false,
      });
    })
  );

  bindCleanup(
    platform.updater.onDownloaded((info) => {
      updateGlobalState({
        status: { ...globalState.status, updateDownloaded: true },
        info: info || globalState.info,
        downloadProgress: 100,
        isDownloading: false,
        isInstalling: false,
      });
    })
  );

  bindCleanup(
    platform.updater.onDownloadProgress((progress) => {
      updateGlobalState({
        downloadProgress: normalizeProgress(progress),
        isDownloading: true,
      });
    })
  );

  bindCleanup(
    platform.updater.onError((error) => {
      updateGlobalState({
        isChecking: false,
        isDownloading: false,
        isInstalling: false,
        error: toError(error),
      });
    })
  );
}

function cleanup() {
  if (stateListeners.size === 0 && listenersRegistered) {
    cleanupFunctions.forEach((fn) => fn());
    cleanupFunctions.length = 0;
    listenersRegistered = false;
  }
}

export function useUpdater() {
  const [state, setState] = useState<UpdateState>(globalState);
  const isInstallingRef = useRef(false);

  useEffect(() => {
    stateListeners.add(setState);
    registerEventListeners();

    const initializeUpdateStatus = async () => {
      try {
        const status = await platform.updater.getStatus();
        updateGlobalState({ status });

        const info = await platform.updater.getInfo();
        if (info) {
          updateGlobalState({ info });
        }
      } catch (error) {
        console.error("Failed to initialize update status:", error);
      }
    };

    void initializeUpdateStatus();

    return () => {
      stateListeners.delete(setState);
      cleanup();
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    updateGlobalState({ isChecking: true, error: null });
    try {
      const result = await platform.updater.checkForUpdates();
      updateGlobalState({
        isChecking: false,
        status: {
          ...globalState.status,
          updateAvailable: result.updateAvailable,
          updateDownloaded: result.updateAvailable ? globalState.status.updateDownloaded : false,
        },
        info: updateInfoFromCheckResult(result),
      });
      return result;
    } catch (error) {
      updateGlobalState({
        isChecking: false,
        error: toError(error),
      });
      throw error;
    }
  }, []);

  const downloadUpdate = useCallback(async () => {
    if (state.status.updateDownloaded) {
      return { success: true, message: "Update already downloaded" };
    }

    updateGlobalState({ isDownloading: true, downloadProgress: 0, error: null });
    try {
      const result = await platform.updater.downloadUpdate();
      if (!result.success) {
        updateGlobalState({
          isDownloading: false,
          error: new Error(result.message),
        });
      }
      return result;
    } catch (error) {
      updateGlobalState({
        isDownloading: false,
        error: toError(error),
      });
      throw error;
    }
  }, [state.status.updateDownloaded]);

  const installUpdate = useCallback(async () => {
    if (!state.status.updateDownloaded) {
      throw new Error("No update available to install");
    }

    updateGlobalState({ isInstalling: true, error: null });
    isInstallingRef.current = true;

    try {
      const result = await platform.updater.installUpdate();
      if (!result.success) {
        throw new Error(result.message);
      }

      setTimeout(() => {
        if (isInstallingRef.current) {
          isInstallingRef.current = false;
          updateGlobalState({ isInstalling: false });
        }
      }, 10000);

      return result;
    } catch (error) {
      isInstallingRef.current = false;
      updateGlobalState({
        isInstalling: false,
        error: toError(error),
      });
      throw error;
    }
  }, [state.status.updateDownloaded]);

  const getAppVersion = useCallback(async () => {
    try {
      const result = await platform.updater.getAppVersion();
      return result.version || null;
    } catch {
      return null;
    }
  }, []);

  return {
    status: state.status,
    info: state.info,
    downloadProgress: state.downloadProgress,
    isChecking: state.isChecking,
    isDownloading: state.isDownloading,
    isInstalling: state.isInstalling,
    error: state.error,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    getAppVersion,
  };
}
