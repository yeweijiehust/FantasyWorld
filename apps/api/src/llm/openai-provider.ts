import OpenAI from "openai";
import type { ModelProbeResult } from "@fantasy-world/shared";
import {
  publicModelConfig,
  type LlmProvider,
  type LlmProviderJsonRequest,
  type LlmProviderJsonResult,
  type LlmJsonUsage
} from "./types.js";

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
      timeout: 15_000
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
          error: normalizeLlmError(textProbe.error ?? jsonProbe.error)
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
      timeout: 30_000
    });

    try {
      const response = await client.chat.completions.create({
        model: input.model,
        messages: [
          {
            role: "system",
            content: [
              request.systemPrompt,
              `Return only valid JSON for ${request.schemaName}.`,
              "The JSON must match this TypeBox schema:",
              JSON.stringify(request.schema)
            ].join("\n\n")
          },
          {
            role: "user",
            content: request.userPrompt
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: request.maxTokens ?? 2_000,
        temperature: request.temperature ?? 0.4
      });
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
    } catch (error) {
      return {
        ok: false,
        provider: "openai-compatible",
        latencyMs: Math.round(performance.now() - startedAt),
        error: normalizeLlmError(error)
      } satisfies LlmProviderJsonResult;
    }
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

function normalizeLlmError(error: unknown) {
  const candidate = error as { status?: number; code?: string; message?: string };

  if (candidate.status === 401 || candidate.code === "invalid_api_key") {
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

  if (candidate.status === 429) {
    return {
      code: "rate_limited",
      message: "The model provider rate limited the request"
    };
  }

  if (candidate.status && candidate.status >= 500) {
    return {
      code: "provider_unavailable",
      message: "The model provider is temporarily unavailable"
    };
  }

  return {
    code: "connection_failed",
    message: "The model connection test failed"
  };
}
