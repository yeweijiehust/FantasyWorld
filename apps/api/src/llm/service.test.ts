import type { ModelProbeResult } from "@fantasy-world/shared";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { LlmService } from "./service.js";
import type { LlmProvider } from "./types.js";
import { PrototypeStore } from "../store/prototype-store.js";

describe("LLM service", () => {
  it("uses the mock provider when no API key is configured", async () => {
    const store = new PrototypeStore();
    const service = new LlmService(store);

    const result = await service.probeModel({
      baseUrl: "https://models.example.test/v1",
      model: "mock-model"
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("mock");
    expect(result.config.supportsJsonMode).toBe(true);
    expect(result.config.supportsUsage).toBe(true);
    expect(result.config.supportsStream).toBe(false);
  });

  it("uses the OpenAI-compatible provider when an API key is supplied", async () => {
    const store = new PrototypeStore();
    const openAiProvider: LlmProvider = {
      probe(input): Promise<ModelProbeResult> {
        const config: ModelProbeResult["config"] = {
          baseUrl: input.baseUrl,
          model: input.model,
          hasApiKey: Boolean(input.apiKey),
          supportsJsonMode: true,
          supportsUsage: false,
          supportsStream: true
        };

        if (input.apiKey) {
          config.apiKeyTail = input.apiKey.slice(-4);
        }

        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config,
          latencyMs: 1
        });
      },
      generateJson() {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          output: {},
          latencyMs: 1
        });
      }
    };
    const service = new LlmService(store, undefined, openAiProvider);

    const result = await service.probeModel({
      baseUrl: "https://models.example.test/v1",
      model: "live-model",
      apiKey: "test-api-key-value"
    });

    expect(result.provider).toBe("openai-compatible");
    expect(result.config.apiKeyTail).toBe("alue");
    expect(result.config.supportsStream).toBe(true);
    expect(JSON.stringify(result)).not.toContain("test-api-key-value");
  });

  it("generates and validates structured JSON through the mock provider", async () => {
    const store = new PrototypeStore();
    const service = new LlmService(store);
    const schema = Type.Object({
      title: Type.String({ minLength: 1 }),
      count: Type.Number({ minimum: 1 })
    });

    const result = await service.generateJson({
      schema,
      schemaName: "TestOutput",
      systemPrompt: "Return test JSON.",
      userPrompt: "Create one item.",
      mockOutput: {
        title: "Mock output",
        count: 1
      }
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.provider).toBe("mock");
      expect(result.output.title).toBe("Mock output");
      expect(result.output.count).toBe(1);
    }
  });

  it("returns a stable schema failure for invalid structured JSON", async () => {
    const store = new PrototypeStore();
    const service = new LlmService(store);
    const result = await service.generateJson({
      schema: Type.Object({
        title: Type.String({ minLength: 1 })
      }),
      schemaName: "InvalidOutput",
      systemPrompt: "Return test JSON.",
      userPrompt: "Create one item.",
      mockOutput: {
        title: ""
      }
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.provider).toBe("mock");
      expect(result.error.code).toBe("schema_validation_failed");
      expect(result.error.message).toContain("InvalidOutput");
    }
  });

  it("uses the OpenAI-compatible provider for structured JSON when an API key is configured", async () => {
    const store = new PrototypeStore();
    store.updateModelConfig({
      baseUrl: "https://models.example.test/v1",
      model: "live-model",
      apiKey: "test-api-key-value"
    });
    const openAiProvider: LlmProvider = {
      probe() {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config: {
            baseUrl: "https://models.example.test/v1",
            model: "live-model",
            hasApiKey: true,
            apiKeyTail: "alue"
          },
          latencyMs: 1
        });
      },
      generateJson(input) {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          output: {
            title: input.model
          },
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14
          },
          latencyMs: 1
        });
      }
    };
    const service = new LlmService(store, undefined, openAiProvider);
    const result = await service.generateJson({
      schema: Type.Object({
        title: Type.String({ minLength: 1 })
      }),
      schemaName: "LiveOutput",
      systemPrompt: "Return test JSON.",
      userPrompt: "Create one item.",
      mockOutput: {
        title: "unused"
      }
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("test-api-key-value");

    if (result.ok) {
      expect(result.provider).toBe("openai-compatible");
      expect(result.output.title).toBe("live-model");
      expect(result.usage?.totalTokens).toBe(14);
    }
  });
});
