import { BaseReasoningService } from "./BaseReasoningService";
import logger from "../utils/logger";

class LocalReasoningService extends BaseReasoningService {
  async processText(
    text: string,
    modelId: string = "qwen2.5-7b-instruct-q5_k_m",
    agentName: string | null = null
  ): Promise<string> {
    logger.logReasoning("LOCAL_MODEL_UNAVAILABLE", {
      modelId,
      agentName,
      textLength: text.length,
      runtime: "tauri",
    });

    throw new Error("Local reasoning is not available in the active Tauri runtime");
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async getDownloadedModels(): Promise<unknown[]> {
    return [];
  }
}

export default new LocalReasoningService();
