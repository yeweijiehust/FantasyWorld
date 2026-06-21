import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCredentials } from "../store/types.js";

const openAiMock = vi.hoisted(() => ({
  create: vi.fn()
}));

vi.mock("openai", () => ({
  default: vi.fn(function MockOpenAI() {
    return {
      chat: {
        completions: {
          create: openAiMock.create
        }
      }
    };
  })
}));

import { OpenAiCompatibleProvider, normalizeLlmError, resolveLlmGenerationTimeoutMs } from "./openai-provider.js";

describe("OpenAI-compatible provider", () => {
  beforeEach(() => {
    openAiMock.create.mockReset();
  });

  it("uses a longer default timeout for real generation", () => {
    expect(resolveLlmGenerationTimeoutMs()).toBe(120_000);
    expect(resolveLlmGenerationTimeoutMs("180000")).toBe(180_000);
    expect(resolveLlmGenerationTimeoutMs("5000")).toBe(15_000);
    expect(resolveLlmGenerationTimeoutMs("600000")).toBe(300_000);
  });

  it("normalizes generation timeouts without calling them connection tests", () => {
    const error = normalizeLlmError(
      {
        name: "APIConnectionTimeoutError",
        message: "Request timed out."
      },
      "generation"
    );

    expect(error.code).toBe("provider_timeout");
    expect(error.message).toContain("generation");
    expect(error.message).not.toContain("connection test");
  });

  it("omits JSON mode when the saved model config does not support it", async () => {
    openAiMock.create.mockResolvedValueOnce(completion('{"title":"ok"}'));
    const provider = new OpenAiCompatibleProvider();

    const result = await provider.generateJson(credentials({ supportsJsonMode: false }), request());
    const params = openAiMock.create.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(params).not.toHaveProperty("response_format");
  });

  it("falls back to plain chat completion when JSON mode is rejected", async () => {
    openAiMock.create
      .mockRejectedValueOnce({
        status: 400,
        message: "response_format json_object is not supported by this model"
      })
      .mockResolvedValueOnce(completion('{"title":"fallback"}'));
    const provider = new OpenAiCompatibleProvider();

    const result = await provider.generateJson(credentials(), request());
    const firstParams = openAiMock.create.mock.calls[0]?.[0] as Record<string, unknown>;
    const secondParams = openAiMock.create.mock.calls[1]?.[0] as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(firstParams.response_format).toEqual({ type: "json_object" });
    expect(secondParams).not.toHaveProperty("response_format");
  });
});

function credentials(overrides: Partial<ModelCredentials> = {}): ModelCredentials {
  return {
    baseUrl: "https://models.example.test/v1",
    model: "test-model",
    hasApiKey: true,
    apiKey: "test-api-key",
    supportsJsonMode: true,
    supportsUsage: true,
    supportsStream: false,
    ...overrides
  };
}

function request() {
  return {
    schema: Type.Object({
      title: Type.String()
    }),
    schemaName: "TestOutput",
    systemPrompt: "Return test JSON.",
    userPrompt: "Create one item."
  };
}

function completion(content: string) {
  return {
    choices: [
      {
        message: {
          content
        }
      }
    ],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 4,
      total_tokens: 12
    }
  };
}
