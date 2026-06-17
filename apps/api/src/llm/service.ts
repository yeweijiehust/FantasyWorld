import type { ModelProbeInput, ModelProbeResult } from "@fantasy-world/shared";
import { MockLlmProvider } from "./mock-provider.js";
import { OpenAiCompatibleProvider } from "./openai-provider.js";
import { resolveProbeCredentials, type LlmProvider } from "./types.js";
import type { FantasyWorldStore } from "../store/types.js";

export class LlmService {
  constructor(
    private readonly store: FantasyWorldStore,
    private readonly mockProvider: LlmProvider = new MockLlmProvider(),
    private readonly openAiProvider: LlmProvider = new OpenAiCompatibleProvider()
  ) {}

  async probeModel(input: ModelProbeInput = {}): Promise<ModelProbeResult> {
    const credentials = resolveProbeCredentials({
      ...input,
      stored: await this.store.getModelCredentials()
    });

    if (!credentials.apiKey) {
      return this.mockProvider.probe(credentials);
    }

    return this.openAiProvider.probe(credentials);
  }
}
