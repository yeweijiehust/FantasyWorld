import type { ModelConfig, ModelProbeInput, ModelProbeResult } from "@fantasy-world/shared";
import type { TSchema } from "typebox";
import type { ModelCredentials, ModelCredentialsScope } from "../store/types.js";

export type LlmProbeRequest = ModelProbeInput & {
  stored: ModelCredentials;
};

export type LlmProvider = {
  probe(input: ModelCredentials): Promise<ModelProbeResult>;
  generateJson(input: ModelCredentials, request: LlmProviderJsonRequest): Promise<LlmProviderJsonResult>;
};

export type LlmJsonUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
};

export type LlmJsonError = {
  code: string;
  message: string;
};

export type LlmJsonRequest<T extends TSchema = TSchema> = {
  schema: T;
  schemaName: string;
  systemPrompt: string;
  userPrompt: string;
  mockOutput: unknown;
  saveId?: string;
  modelOverride?: ModelCredentialsScope["modelOverride"];
  temperature?: number;
  maxTokens?: number;
};

export type LlmProviderJsonRequest = Omit<LlmJsonRequest, "mockOutput"> & {
  mockOutput?: unknown;
};

export type LlmProviderJsonResult =
  | {
      ok: true;
      provider: "mock" | "openai-compatible";
      output: unknown;
      rawOutput?: string;
      usage?: LlmJsonUsage;
      latencyMs: number;
    }
  | {
      ok: false;
      provider: "mock" | "openai-compatible";
      rawOutput?: string;
      usage?: LlmJsonUsage;
      error: LlmJsonError;
      latencyMs: number;
    };

export type LlmJsonResult<T> =
  | {
      ok: true;
      provider: "mock" | "openai-compatible";
      model: string;
      output: T;
      rawOutput?: string;
      usage?: LlmJsonUsage;
      estimatedCostUsd?: number;
      inputTokenPriceUsdPerMillion?: number;
      outputTokenPriceUsdPerMillion?: number;
      latencyMs: number;
    }
  | {
      ok: false;
      provider: "mock" | "openai-compatible";
      model: string;
      rawOutput?: string;
      usage?: LlmJsonUsage;
      estimatedCostUsd?: number;
      inputTokenPriceUsdPerMillion?: number;
      outputTokenPriceUsdPerMillion?: number;
      error: LlmJsonError;
      latencyMs: number;
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
