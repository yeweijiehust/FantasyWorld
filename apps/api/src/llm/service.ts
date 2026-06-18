import type { ModelProbeInput, ModelProbeResult } from "@fantasy-world/shared";
import { Compile } from "typebox/compile";
import type { Static, TSchema } from "typebox";
import { MockLlmProvider } from "./mock-provider.js";
import { OpenAiCompatibleProvider } from "./openai-provider.js";
import {
  resolveProbeCredentials,
  type LlmJsonRequest,
  type LlmJsonResult,
  type LlmJsonUsage,
  type LlmProvider
} from "./types.js";
import type { FantasyWorldStore, ModelCredentials } from "../store/types.js";

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
    const usage = normalizeResultUsage(result.usage, request, result.rawOutput ?? resultOutput(result));
    const price = estimateCostUsd(usage, credentials);
    const priced = withPrice(result, credentials, usage, price);

    if (!priced.ok) {
      return priced;
    }

    const check = Compile(request.schema);

    if (!check.Check(priced.output)) {
      const firstError = [...check.Errors(priced.output)][0];

      return {
        ok: false,
        provider: priced.provider,
        model: credentials.model,
        ...(priced.rawOutput ? { rawOutput: priced.rawOutput } : {}),
        usage,
        ...price,
        latencyMs: priced.latencyMs,
        error: {
          code: "schema_validation_failed",
          message: firstError
            ? `LLM output did not match ${request.schemaName}: ${firstError.message}`
            : "LLM output did not match the expected schema"
        }
      };
    }

    return {
      ...priced,
      output: priced.output
    };
  }
}

function withPrice<T extends { ok: boolean; provider: "mock" | "openai-compatible"; latencyMs: number }>(
  result: T,
  credentials: ModelCredentials,
  usage: LlmJsonUsage,
  price: LlmPrice
): T & {
  model: string;
  usage: LlmJsonUsage;
  estimatedCostUsd?: number;
  inputTokenPriceUsdPerMillion?: number;
  outputTokenPriceUsdPerMillion?: number;
} {
  return {
    ...result,
    model: credentials.model,
    usage,
    ...price
  };
}

type LlmPrice = {
  estimatedCostUsd?: number;
  inputTokenPriceUsdPerMillion?: number;
  outputTokenPriceUsdPerMillion?: number;
};

function normalizeResultUsage(usage: LlmJsonUsage | undefined, request: LlmJsonRequest, output: unknown): LlmJsonUsage {
  if (usage?.totalTokens !== undefined || usage?.inputTokens !== undefined || usage?.outputTokens !== undefined) {
    return usage;
  }

  const inputTokens = estimateTokens(`${request.systemPrompt}\n${request.userPrompt}`);
  const outputTokens = estimateTokens(typeof output === "string" ? output : JSON.stringify(output ?? ""));

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimated: true
  };
}

function estimateCostUsd(usage: LlmJsonUsage, credentials: ModelCredentials): LlmPrice {
  const inputPrice = credentials.inputTokenPriceUsdPerMillion;
  const outputPrice = credentials.outputTokenPriceUsdPerMillion;
  const price: LlmPrice = {
    ...(inputPrice !== undefined ? { inputTokenPriceUsdPerMillion: inputPrice } : {}),
    ...(outputPrice !== undefined ? { outputTokenPriceUsdPerMillion: outputPrice } : {})
  };

  if (inputPrice === undefined && outputPrice === undefined) {
    return price;
  }

  const inputCost = ((usage.inputTokens ?? 0) / 1_000_000) * (inputPrice ?? 0);
  const outputCost = ((usage.outputTokens ?? 0) / 1_000_000) * (outputPrice ?? 0);

  return {
    ...price,
    estimatedCostUsd: roundCost(inputCost + outputCost)
  };
}

function estimateTokens(input: string) {
  return Math.max(1, Math.ceil(input.length / 4));
}

function roundCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function resultOutput(result: { ok: boolean; output?: unknown }) {
  return result.ok ? result.output : "";
}
