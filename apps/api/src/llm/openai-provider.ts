import OpenAI from "openai";
import type { ModelProbeResult } from "@fantasy-world/shared";
import type { ModelCredentials } from "../store/types.js";
import {
  publicModelConfig,
  type LlmProvider,
  type LlmProviderJsonRequest,
  type LlmProviderJsonResult,
  type LlmJsonUsage
} from "./types.js";

const defaultProbeTimeoutMs = 15_000;
const defaultGenerationTimeoutMs = 120_000;
const minimumGenerationTimeoutMs = 15_000;
const maximumGenerationTimeoutMs = 300_000;

export class OpenAiCompatibleProvider implements LlmProvider {
  async probe(input: Parameters<LlmProvider["probe"]>[0]): Promise<ModelProbeResult> {
    const startedAt = performance.now();

    if (!input.apiKey) {
      return {
        ok: false,
        provider: "openai-compatible",
        config: publicModelConfig(input),
        latencyMs: Math.round(performance.now() - startedAt),
        error: {
          code: "missing_api_key",
          message: "API key is required to test this model connection"
        }
      };
    }

    const client = new OpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl,
      maxRetries: 0,
      timeout: defaultProbeTimeoutMs
    });
    const baseConfig = publicModelConfig(input);
    const jsonProbe = await probeJsonMode(client, input.model);
    let supportsJsonMode = jsonProbe.ok;
    let supportsUsage = Boolean(jsonProbe.usage);

    if (!jsonProbe.ok) {
      const textProbe = await probeTextCompletion(client, input.model);

      if (!textProbe.ok) {
        return {
          ok: false,
          provider: "openai-compatible",
          config: {
            ...baseConfig,
            supportsJsonMode: false,
            supportsUsage: false,
            supportsStream: false
          },
          latencyMs: Math.round(performance.now() - startedAt),
          error: normalizeLlmError(textProbe.error ?? jsonProbe.error, "probe")
        };
      }

      supportsJsonMode = false;
      supportsUsage = Boolean(textProbe.fallbackUsage);
    }

    const streamProbe = await probeStream(client, input.model);

    return {
      ok: true,
      provider: "openai-compatible",
      config: {
        ...baseConfig,
        supportsJsonMode,
        supportsUsage,
        supportsStream: streamProbe.ok
      },
      latencyMs: Math.round(performance.now() - startedAt)
    };
  }

  async generateJson(
    input: Parameters<LlmProvider["generateJson"]>[0],
    request: LlmProviderJsonRequest
  ): Promise<LlmProviderJsonResult> {
    const startedAt = performance.now();

    if (!input.apiKey) {
      return {
        ok: false,
        provider: "openai-compatible",
        latencyMs: Math.round(performance.now() - startedAt),
        error: {
          code: "missing_api_key",
          message: "API key is required to generate structured JSON"
        }
      } satisfies LlmProviderJsonResult;
    }

    const client = new OpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl,
      maxRetries: 0,
      timeout: resolveLlmGenerationTimeoutMs()
    });

    try {
      const response = await createJsonCompletion(client, input, request, input.supportsJsonMode !== false);
      return parseJsonCompletion(response, startedAt);
    } catch (error) {
      if (input.supportsJsonMode !== false && isJsonModeUnsupportedError(error)) {
        try {
          const response = await createJsonCompletion(client, input, request, false);
          return parseJsonCompletion(response, startedAt);
        } catch (fallbackError) {
          return {
            ok: false,
            provider: "openai-compatible",
            latencyMs: Math.round(performance.now() - startedAt),
            error: normalizeLlmError(fallbackError, "generation")
          } satisfies LlmProviderJsonResult;
        }
      }

      return {
        ok: false,
        provider: "openai-compatible",
        latencyMs: Math.round(performance.now() - startedAt),
        error: normalizeLlmError(error, "generation")
      } satisfies LlmProviderJsonResult;
    }
  }
}

export function resolveLlmGenerationTimeoutMs(raw = process.env.LLM_GENERATION_TIMEOUT_MS) {
  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultGenerationTimeoutMs;
  }

  return Math.min(Math.max(Math.round(parsed), minimumGenerationTimeoutMs), maximumGenerationTimeoutMs);
}

async function createJsonCompletion(
  client: OpenAI,
  input: ModelCredentials,
  request: LlmProviderJsonRequest,
  useJsonMode: boolean
) {
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: input.model,
    messages: [
      {
        role: "system",
        content: [
          request.systemPrompt,
          `Return only valid JSON for ${request.schemaName}.`,
          "Do not wrap the JSON in Markdown code fences.",
          "The JSON must match this TypeBox schema:",
          JSON.stringify(request.schema)
        ].join("\n\n")
      },
      {
        role: "user",
        content: request.userPrompt
      }
    ],
    max_tokens: request.maxTokens ?? 2_000,
    temperature: request.temperature ?? 0.4
  };

  if (useJsonMode) {
    params.response_format = { type: "json_object" };
  }

  return client.chat.completions.create(params);
}

function parseJsonCompletion(
  response: OpenAI.Chat.Completions.ChatCompletion,
  startedAt: number
): LlmProviderJsonResult {
  const rawOutput = response.choices[0]?.message?.content ?? "";
  const usage = normalizeUsage(response.usage);

  if (!rawOutput.trim()) {
    return {
      ok: false,
      provider: "openai-compatible",
      rawOutput,
      ...(usage ? { usage } : {}),
      latencyMs: Math.round(performance.now() - startedAt),
      error: {
        code: "empty_response",
        message: "The model returned an empty response"
      }
    } satisfies LlmProviderJsonResult;
  }

  try {
    return {
      ok: true,
      provider: "openai-compatible",
      output: JSON.parse(rawOutput) as unknown,
      rawOutput,
      ...(usage ? { usage } : {}),
      latencyMs: Math.round(performance.now() - startedAt)
    };
  } catch {
    return {
      ok: false,
      provider: "openai-compatible",
      rawOutput,
      ...(usage ? { usage } : {}),
      latencyMs: Math.round(performance.now() - startedAt),
      error: {
        code: "invalid_json",
        message: "The model returned invalid JSON"
      }
    } satisfies LlmProviderJsonResult;
  }
}

function normalizeUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
) {
  if (!usage) {
    return undefined;
  }

  const normalized: LlmJsonUsage = {};

  if (typeof usage.prompt_tokens === "number") {
    normalized.inputTokens = usage.prompt_tokens;
  }

  if (typeof usage.completion_tokens === "number") {
    normalized.outputTokens = usage.completion_tokens;
  }

  if (typeof usage.total_tokens === "number") {
    normalized.totalTokens = usage.total_tokens;
  }

  return normalized;
}

async function probeJsonMode(client: OpenAI, model: string) {
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are a JSON capability probe. Return only valid JSON."
        },
        {
          role: "user",
          content: 'Return {"ok":true}.'
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 20,
      temperature: 0
    });

    return {
      ok: true,
      usage: response.usage
    };
  } catch (error) {
    return {
      ok: false,
      error
    };
  }
}

async function probeTextCompletion(client: OpenAI, model: string) {
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: "Reply with OK."
        }
      ],
      max_tokens: 5,
      temperature: 0
    });

    return {
      ok: true,
      fallbackUsage: response.usage
    };
  } catch (error) {
    return {
      ok: false,
      error
    };
  }
}

async function probeStream(client: OpenAI, model: string) {
  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: "Reply with OK."
        }
      ],
      max_tokens: 5,
      temperature: 0,
      stream: true,
      stream_options: {
        include_usage: true
      }
    });

    for await (const chunk of stream) {
      void chunk;
      break;
    }

    return { ok: true };
  } catch {
    return { ok: false };
  }
}

type LlmErrorContext = "probe" | "generation";

export function normalizeLlmError(error: unknown, context: LlmErrorContext = "probe") {
  const candidate = error as {
    status?: number;
    code?: string;
    message?: string;
    name?: string;
    type?: string;
    error?: {
      code?: string;
      message?: string;
      type?: string;
    };
  };
  const code = candidate.code ?? candidate.error?.code;
  const message = candidate.message ?? candidate.error?.message;
  const type = candidate.type ?? candidate.error?.type;
  const normalizedMessage = message?.toLowerCase() ?? "";
  const normalizedName = candidate.name?.toLowerCase() ?? "";

  if (candidate.status === 401 || code === "invalid_api_key") {
    return {
      code: "invalid_api_key",
      message: "The model provider rejected the API key"
    };
  }

  if (candidate.status === 404) {
    return {
      code: "model_not_found",
      message: "The configured model was not found by the provider"
    };
  }

  if (candidate.status === 402 || code === "insufficient_quota") {
    return {
      code: "provider_quota_exceeded",
      message: "The model provider reported insufficient quota or credits"
    };
  }

  if (candidate.status === 403) {
    return {
      code: "provider_forbidden",
      message: "The model provider rejected this request for the configured account or model"
    };
  }

  if (candidate.status === 408 || isTimeoutError(code, normalizedName, normalizedMessage)) {
    return {
      code: "provider_timeout",
      message:
        context === "generation"
          ? "The model generation request timed out before a response was returned"
          : "The model connection test timed out before a response was returned"
    };
  }

  if (candidate.status === 429) {
    return {
      code: "rate_limited",
      message: "The model provider rate limited the request"
    };
  }

  if (isJsonModeUnsupportedError(error)) {
    return {
      code: "json_mode_unsupported",
      message: "The configured model rejected JSON mode for structured output"
    };
  }

  if (candidate.status === 400 || candidate.status === 422) {
    return {
      code: "provider_bad_request",
      message: providerMessage(message, "The model provider rejected the generation request")
    };
  }

  if (candidate.status && candidate.status >= 500) {
    return {
      code: "provider_unavailable",
      message: "The model provider is temporarily unavailable"
    };
  }

  if (isNetworkError(code, normalizedName, type)) {
    return {
      code: "connection_failed",
      message: "The model provider could not be reached"
    };
  }

  if (message) {
    return {
      code: "provider_error",
      message: providerMessage(message, "The model provider returned an error")
    };
  }

  return {
    code: "connection_failed",
    message:
      context === "generation"
        ? "The model generation request failed before a response was returned"
        : "The model connection test failed before a response was returned"
  };
}

function isTimeoutError(code: string | undefined, name: string, message: string) {
  return (
    code === "ETIMEDOUT" || name.includes("timeout") || message.includes("timed out") || message.includes("timeout")
  );
}

function isNetworkError(code: string | undefined, name: string, type: string | undefined) {
  const networkCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);
  return (
    Boolean(code && networkCodes.has(code)) || name.includes("apiconnectionerror") || type === "api_connection_error"
  );
}

function isJsonModeUnsupportedError(error: unknown) {
  const candidate = error as { status?: number; message?: string; error?: { message?: string } };
  const message = (candidate.message ?? candidate.error?.message ?? "").toLowerCase();

  return (
    (candidate.status === 400 || candidate.status === 422) &&
    (message.includes("response_format") ||
      message.includes("json mode") ||
      message.includes("json_object") ||
      message.includes("structured output"))
  );
}

function providerMessage(message: string | undefined, fallback: string) {
  const normalized = message?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.length > 300 ? `${normalized.slice(0, 300)}...` : normalized;
}
