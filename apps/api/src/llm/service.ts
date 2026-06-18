import type { ModelProbeInput, ModelProbeResult } from "@fantasy-world/shared";
import { Compile } from "typebox/compile";
import type { Static, TSchema } from "typebox";
import { MockLlmProvider } from "./mock-provider.js";
import { OpenAiCompatibleProvider } from "./openai-provider.js";
import { resolveProbeCredentials, type LlmJsonRequest, type LlmJsonResult, type LlmProvider } from "./types.js";
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

  async generateJson<T extends TSchema>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<Static<T>>> {
    const credentials = await this.store.getModelCredentials({
      ...(request.saveId ? { saveId: request.saveId } : {}),
      ...(request.modelOverride ? { modelOverride: request.modelOverride } : {})
    });
    const provider = credentials.apiKey ? this.openAiProvider : this.mockProvider;
    const result = await provider.generateJson(credentials, request);

    if (!result.ok) {
      return result;
    }

    const check = Compile(request.schema);

    if (!check.Check(result.output)) {
      const firstError = [...check.Errors(result.output)][0];

      return {
        ok: false,
        provider: result.provider,
        ...(result.rawOutput ? { rawOutput: result.rawOutput } : {}),
        latencyMs: result.latencyMs,
        error: {
          code: "schema_validation_failed",
          message: firstError
            ? `LLM output did not match ${request.schemaName}: ${firstError.message}`
            : "LLM output did not match the expected schema"
        }
      };
    }

    return {
      ...result,
      output: result.output
    };
  }
}
