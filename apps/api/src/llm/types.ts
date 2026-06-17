import type { ModelConfig, ModelProbeInput, ModelProbeResult } from "@fantasy-world/shared";
import type { ModelCredentials } from "../store/types.js";

export type LlmProbeRequest = ModelProbeInput & {
  stored: ModelCredentials;
};

export type LlmProvider = {
  probe(input: ModelCredentials): Promise<ModelProbeResult>;
};

export function resolveProbeCredentials(input: LlmProbeRequest): ModelCredentials {
  const apiKey = input.apiKey?.trim() || input.stored.apiKey;
  const config: ModelConfig = {
    ...input.stored,
    baseUrl: input.baseUrl?.trim() || input.stored.baseUrl,
    model: input.model?.trim() || input.stored.model,
    hasApiKey: Boolean(apiKey) || input.stored.hasApiKey
  };

  if (apiKey) {
    return {
      ...config,
      apiKey
    };
  }

  return config;
}

export function publicModelConfig(input: ModelCredentials): ModelConfig {
  const { apiKey, ...config } = input;

  return {
    ...config,
    hasApiKey: Boolean(apiKey) || config.hasApiKey
  };
}
