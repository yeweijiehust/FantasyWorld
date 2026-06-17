import type { ModelProbeResult } from "@fantasy-world/shared";
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
});
