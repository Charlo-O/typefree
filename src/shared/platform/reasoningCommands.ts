import { normalizeCommandError } from "./commandCore";
import { getAnthropicKey } from "./settingsCommands";
import type { NativeReasoningConfig, NativeReasoningResult } from "./types";

export async function processAnthropicReasoning(
  text: string,
  modelId: string,
  agentName: string | null,
  config: NativeReasoningConfig
): Promise<NativeReasoningResult> {
  try {
    const apiKey = await getAnthropicKey();
    if (!apiKey) {
      return { success: false, error: "Anthropic API key not configured" };
    }

    const { getSystemPrompt } = await import("../../config/prompts");
    const systemPrompt = getSystemPrompt(agentName, config?.promptContext || null);

    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("process_anthropic_reasoning", {
      req: {
        api_key: apiKey,
        model: modelId,
        system_prompt: systemPrompt,
        text,
        max_tokens: config?.maxTokens ?? null,
        temperature: config?.temperature ?? null,
      },
    });

    return result as NativeReasoningResult;
  } catch (error: unknown) {
    return { success: false, error: normalizeCommandError(error).message };
  }
}

export async function checkLocalReasoningAvailable(): Promise<boolean> {
  return false;
}

export async function processLocalReasoning(
  _text: string,
  _modelId: string,
  _agentName: string | null,
  _config: NativeReasoningConfig
): Promise<NativeReasoningResult> {
  return { success: false, error: "Local reasoning is not available in this build" };
}
