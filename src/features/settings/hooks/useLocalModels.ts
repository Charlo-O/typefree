import { useState, useEffect, useCallback } from "react";
import platform from "../../../shared/platform";
import type { ModelDefinition } from "../../../models/ModelRegistry";
import type { LocalModelRecord, ModelDownloadProgressPayload } from "../../../shared/platform";

interface ModelWithStatus extends ModelDefinition {
  isDownloaded: boolean;
  isDownloading: boolean;
  downloadProgress: number;
}

function toModelWithStatus(model: LocalModelRecord): ModelWithStatus {
  return {
    ...model,
    isDownloaded: !!model.isDownloaded || !!model.downloaded,
    isDownloading: !!model.isDownloading,
    downloadProgress: model.downloadProgress ?? 0,
  };
}

export function useLocalModels() {
  const [models, setModels] = useState<ModelWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Map<string, ModelDownloadProgressPayload>>(
    new Map()
  );

  const loadModels = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const modelsData = await platform.models.getAll();
      setModels(modelsData.map(toModelWithStatus));
    } catch (err) {
      setError("Failed to load models");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();

    // Set up progress listener
    const handleProgress = (data: ModelDownloadProgressPayload) => {
      setProgressMap((prev) => new Map(prev).set(data.modelId, data));
    };

    const disposeProgress = platform.models.onDownloadProgress(handleProgress);

    return () => {
      if (typeof disposeProgress === "function") {
        disposeProgress();
      }
    };
  }, [loadModels]);

  const downloadModel = useCallback(
    async (modelId: string) => {
      try {
        await platform.models.download(modelId);
        await loadModels();
      } catch (err) {
        setError(`Failed to download model: ${(err as Error).message}`);
        throw err;
      }
    },
    [loadModels]
  );

  const deleteModel = useCallback(
    async (modelId: string) => {
      try {
        await platform.models.delete(modelId);
        await loadModels();
      } catch (err) {
        setError(`Failed to delete model: ${(err as Error).message}`);
        throw err;
      }
    },
    [loadModels]
  );

  const getModelProgress = useCallback(
    (modelId: string) => {
      return progressMap.get(modelId);
    },
    [progressMap]
  );

  const checkRuntimeAvailable = useCallback(async () => {
    try {
      const result = await platform.models.checkRuntime();
      return result;
    } catch {
      return false;
    }
  }, []);

  const modelsByProvider = models.reduce(
    (acc, model) => {
      const providerId = model.id.split("-")[0] || "other";
      if (!acc[providerId]) {
        acc[providerId] = [];
      }
      acc[providerId].push(model);
      return acc;
    },
    {} as Record<string, ModelWithStatus[]>
  );

  return {
    models,
    modelsByProvider,
    isLoading,
    error,
    downloadModel,
    deleteModel,
    getModelProgress,
    isRuntimeAvailable: checkRuntimeAvailable,
  };
}
