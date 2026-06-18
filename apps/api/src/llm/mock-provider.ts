import type { ModelProbeResult } from "@fantasy-world/shared";
import {
  publicModelConfig,
  type LlmProvider,
  type LlmProviderJsonRequest,
  type LlmProviderJsonResult
} from "./types.js";

export class MockLlmProvider implements LlmProvider {
  probe(input: Parameters<LlmProvider["probe"]>[0]): Promise<ModelProbeResult> {
    const startedAt = performance.now();

    return Promise.resolve({
      ok: true,
      provider: "mock",
      config: {
        ...publicModelConfig(input),
        supportsJsonMode: true,
        supportsUsage: true,
        supportsStream: false
      },
      latencyMs: Math.round(performance.now() - startedAt)
    });
  }

  generateJson(
    _input: Parameters<LlmProvider["generateJson"]>[0],
    request: LlmProviderJsonRequest
  ): Promise<LlmProviderJsonResult> {
    const startedAt = performance.now();

    return Promise.resolve({
      ok: true,
      provider: "mock",
      output: structuredClone(request.mockOutput),
      rawOutput: JSON.stringify(request.mockOutput),
      latencyMs: Math.round(performance.now() - startedAt)
    });
  }
}
