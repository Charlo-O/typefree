import { useState, useCallback, useEffect, useRef } from "react";
import { useDialogs } from "../../../hooks/useDialogs";
import { useToast } from "../../../components/ui/toast-context";
import { useI18n } from "../../../i18n";
import platform from "../../../shared/platform";
import type { ModelDownloadProgressPayload } from "../../../shared/platform";

const PROGRESS_THROTTLE_MS = 100; // Throttle UI updates to prevent flashing

export interface DownloadProgress {
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
  speed?: number;
  eta?: number;
}

interface UseModelDownloadOptions {
  onDownloadComplete?: () => void;
  onModelsCleared?: () => void;
}

export function formatETA(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function useModelDownload({ onDownloadComplete, onModelsCleared }: UseModelDownloadOptions) {
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    percentage: 0,
    downloadedBytes: 0,
    totalBytes: 0,
  });
  const [isCancelling, setIsCancelling] = useState(false);
  const isCancellingRef = useRef(false);
  const lastProgressUpdateRef = useRef(0);

  const { showAlertDialog } = useDialogs();
  const { toast } = useToast();
  const { t } = useI18n();
  const onDownloadCompleteRef = useRef(onDownloadComplete);
  const onModelsClearedRef = useRef(onModelsCleared);

  useEffect(() => {
    onDownloadCompleteRef.current = onDownloadComplete;
  }, [onDownloadComplete]);

  useEffect(() => {
    onModelsClearedRef.current = onModelsCleared;
  }, [onModelsCleared]);

  useEffect(() => {
    const handleModelsCleared = () => onModelsClearedRef.current?.();
    window.addEventListener("openwhispr-models-cleared", handleModelsCleared);
    return () => window.removeEventListener("openwhispr-models-cleared", handleModelsCleared);
  }, []);

  const handleLLMProgress = useCallback((data: ModelDownloadProgressPayload) => {
    // Skip if cancellation is in progress
    if (isCancellingRef.current) return;

    // Throttle UI updates to prevent flashing (server-side throttling is primary, this is backup)
    const now = Date.now();
    const isComplete = data.progress >= 100;
    if (!isComplete && now - lastProgressUpdateRef.current < PROGRESS_THROTTLE_MS) {
      return;
    }
    lastProgressUpdateRef.current = now;

    setDownloadProgress({
      percentage: data.progress || 0,
      downloadedBytes: data.downloadedSize || 0,
      totalBytes: data.totalSize || 0,
    });
  }, []);

  useEffect(() => {
    const dispose = platform.models.onDownloadProgress(handleLLMProgress);

    return () => {
      if (typeof dispose === "function") {
        dispose();
      }
    };
  }, [handleLLMProgress]);

  const downloadModel = useCallback(
    async (modelId: string, onSelectAfterDownload?: (id: string) => void) => {
      // Prevent starting a new download if one is already in progress
      if (downloadingModel) {
        toast({
          title: t("modelDownload.inProgress"),
          description: t("modelDownload.inProgressDesc"),
        });
        return;
      }

      try {
        setDownloadingModel(modelId);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
        lastProgressUpdateRef.current = 0; // Reset throttle timer

        let success = false;

        const result = await platform.models.download(modelId);
        if (result && !result.success && result.error) {
          showAlertDialog({
            title: t("dialog.downloadFailed"),
            description: t("modelDownload.downloadFailedDesc", { error: result.error }),
          });
        } else {
          success = result?.success ?? false;
        }

        if (success) {
          onSelectAfterDownload?.(modelId);
        }

        onDownloadCompleteRef.current?.();
      } catch (error: unknown) {
        // Skip error display if cancellation is in progress
        if (isCancellingRef.current) return;

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          !errorMessage.includes("interrupted by user") &&
          !errorMessage.includes("cancelled by user") &&
          !errorMessage.includes("DOWNLOAD_CANCELLED")
        ) {
          showAlertDialog({
            title: t("dialog.downloadFailed"),
            description: t("modelDownload.downloadFailedDesc", { error: errorMessage }),
          });
        }
      } finally {
        setDownloadingModel(null);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
      }
    },
    [downloadingModel, showAlertDialog, t, toast]
  );

  const deleteModel = useCallback(
    async (modelId: string, onComplete?: () => void) => {
      try {
        await platform.models.delete(modelId);
        toast({
          title: t("modelDownload.deleted"),
          description: t("modelDownload.deleteSuccess"),
        });
        onComplete?.();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        showAlertDialog({
          title: t("modelDownload.deleteFailed"),
          description: t("modelDownload.deleteFailedDesc", { error: errorMessage }),
        });
      }
    },
    [showAlertDialog, t, toast]
  );

  const cancelDownload = useCallback(async () => {
    if (!downloadingModel || isCancelling) return;

    setIsCancelling(true);
    isCancellingRef.current = true;
    try {
      await platform.models.cancelDownload(downloadingModel);
      toast({
        title: t("modelDownload.cancelled"),
        description: t("modelDownload.cancelledDesc"),
      });
    } catch (error) {
      console.error("Failed to cancel download:", error);
    } finally {
      setIsCancelling(false);
      isCancellingRef.current = false;
      setDownloadingModel(null);
      setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
      onDownloadCompleteRef.current?.();
    }
  }, [downloadingModel, isCancelling, t, toast]);

  const isDownloading = downloadingModel !== null;
  const isDownloadingModel = useCallback(
    (modelId: string) => downloadingModel === modelId,
    [downloadingModel]
  );

  return {
    downloadingModel,
    downloadProgress,
    isDownloading,
    isDownloadingModel,
    isCancelling,
    downloadModel,
    deleteModel,
    cancelDownload,
    formatETA,
  };
}
