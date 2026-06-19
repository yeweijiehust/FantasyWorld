import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { buildApp, requiresSession } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDatabaseStore } from "./db/client.js";
import { MockLlmProvider } from "./llm/mock-provider.js";
import { LlmService } from "./llm/service.js";
import type { LlmProvider } from "./llm/types.js";
import { buildGeneratedWorldDraft, buildSave, PrototypeStore } from "./store/prototype-store.js";
import { createTurnOrchestration } from "./turn/orchestrator.js";
import type {
  ModelConfig,
  ModelProbeResult,
  PlayerInput,
  Save,
  SaveCollaborator,
  SaveExport,
  SaveGenerationJob,
  SaveListItem,
  TurnOrchestrationOutput,
  TurnJob
} from "@fantasy-world/shared";

const { Pool } = pg;

const env = loadEnv({
  NODE_ENV: "test",
  SESSION_SECRET: "test-session-secret-test-session-secret",
  ENCRYPTION_KEY: "test-encryption-key",
  DATA_STORE: "memory"
});
const databaseEnv = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: "test-session-secret-test-session-secret",
  ENCRYPTION_KEY: "test-encryption-key",
  DATA_STORE: "postgres"
});
const productionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://fantasyworld:fantasyworld@localhost:5432/fantasyworld",
  SESSION_SECRET: "production-session-secret-32-chars",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  ADMIN_PASSWORD_HASH: "scrypt$salt$hash",
  DATA_STORE: "postgres"
};

async function login(app: ReturnType<typeof buildApp>, username = "admin") {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username,
      password: "fantasyworld"
    }
  });

  expect(response.statusCode).toBe(200);

  const cookie = response.headers["set-cookie"];
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

async function createAcceptedSave(app: ReturnType<typeof buildApp>, cookie: string | undefined, name = "雾港纪元") {
  const generation = await app.inject({
    method: "POST",
    url: "/api/save-generation-jobs",
    headers: {
      cookie
    },
    payload: {
      templateId: "fantasy-frontier",
      name,
      premise: "旧王国崩塌后，边境港口正在形成新的权力秩序。",
      characterSeeds: ["艾琳", "赛勒斯", "莫娜"],
      settings: {
        language: "zh",
        turnTimeScale: "一幕",
        randomness: 25,
        contentBoundary: "PG-13",
        styleGuide: "一致性优先"
      }
    }
  });

  expect(generation.statusCode).toBe(201);

  const job = generation.json<{ id: string }>();
  const accepted = await app.inject({
    method: "POST",
    url: `/api/save-generation-jobs/${job.id}/accept`,
    headers: {
      cookie
    }
  });

  expect(accepted.statusCode).toBe(200);

  return accepted.json<Save>();
}

async function waitForGenerationJob(
  app: ReturnType<typeof buildApp>,
  cookie: string | undefined,
  jobId: string,
  status: SaveGenerationJob["status"]
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/save-generation-jobs/${jobId}`,
      headers: {
        cookie
      }
    });
    const job = response.json<SaveGenerationJob>();

    if (job.status === status) {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Generation job ${jobId} did not reach ${status}`);
}

async function waitForTurnJob(
  app: ReturnType<typeof buildApp>,
  cookie: string | undefined,
  jobId: string,
  status: TurnJob["status"]
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/turn-jobs/${jobId}`,
      headers: {
        cookie
      }
    });
    const job = response.json<TurnJob>();

    if (job.status === status) {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Turn job ${jobId} did not reach ${status}`);
}

describe("environment validation", () => {
  it("requires production secrets and persistent storage", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow("DATABASE_URL");
    expect(() => loadEnv({ ...productionEnv, DATA_STORE: "memory" })).toThrow("DATA_STORE");
    expect(() => loadEnv({ ...productionEnv, ENCRYPTION_KEY: "not-base64" })).toThrow("ENCRYPTION_KEY");
    expect(() => loadEnv({ ...productionEnv, ADMIN_PASSWORD_HASH: undefined })).toThrow("ADMIN_PASSWORD_HASH");
    expect(loadEnv(productionEnv).dataStore).toBe("postgres");
  });
});

describe("FantasyWorld API auth and model config safety", () => {
  it("keeps the production shell public while protecting game APIs", () => {
    expect(requiresSession("/")).toBe(false);
    expect(requiresSession("/assets/index.js")).toBe(false);
    expect(requiresSession("/worlds/demo")).toBe(false);
    expect(requiresSession("/api/health")).toBe(false);
    expect(requiresSession("/api/auth/session")).toBe(false);
    expect(requiresSession("/api/saves")).toBe(true);
    expect(requiresSession("/api/model-config?tab=model")).toBe(true);
  });

  it("serves the production shell without a session while keeping APIs protected", async () => {
    const webDistPath = path.resolve(process.cwd(), "../web/dist");
    mkdirSync(webDistPath, { recursive: true });
    writeFileSync(path.join(webDistPath, "index.html"), "<!doctype html><title>FantasyWorld</title>", "utf8");

    const app = buildApp({ env: loadEnv(productionEnv), store: new PrototypeStore() });

    const shell = await app.inject({
      method: "GET",
      url: "/"
    });
    expect(shell.statusCode).toBe(200);
    expect(shell.payload).toContain("FantasyWorld");

    const head = await app.inject({
      method: "HEAD",
      url: "/"
    });
    expect(head.statusCode).toBe(200);

    const protectedApi = await app.inject({
      method: "GET",
      url: "/api/saves"
    });
    expect(protectedApi.statusCode).toBe(401);

    await app.close();
  });

  it("rejects unauthorized requests, bad passwords, and logged-out sessions", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });

    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/saves"
    });
    expect(unauthorized.statusCode).toBe(401);

    const badLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "wrong-password"
      }
    });
    expect(badLogin.statusCode).toBe(401);

    const cookie = await login(app);
    const authorized = await app.inject({
      method: "GET",
      url: "/api/saves",
      headers: {
        cookie
      }
    });
    expect(authorized.statusCode).toBe(200);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie
      }
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/saves",
      headers: {
        cookie
      }
    });
    expect(afterLogout.statusCode).toBe(401);

    await app.close();
  });

  it("binds sessions to users and isolates saves and jobs by owner", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const aliceCookie = await login(app, "alice");
    const bobCookie = await login(app, "bob");

    const aliceSession = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: aliceCookie
      }
    });
    expect(aliceSession.statusCode).toBe(200);
    expect(aliceSession.json<{ user?: { username: string; role: string } }>().user).toMatchObject({
      username: "alice",
      role: "player"
    });

    const aliceSave = await createAcceptedSave(app, aliceCookie, "Alice World");
    expect(aliceSave.ownerUserId).toBeDefined();

    const aliceList = await app.inject({
      method: "GET",
      url: "/api/saves",
      headers: {
        cookie: aliceCookie
      }
    });
    expect(aliceList.statusCode).toBe(200);
    expect(aliceList.json<SaveListItem[]>()).toHaveLength(1);
    expect(aliceList.json<SaveListItem[]>()[0]?.id).toBe(aliceSave.id);

    const bobList = await app.inject({
      method: "GET",
      url: "/api/saves",
      headers: {
        cookie: bobCookie
      }
    });
    expect(bobList.statusCode).toBe(200);
    expect(bobList.json<SaveListItem[]>()).toHaveLength(0);

    const bobReadAliceSave = await app.inject({
      method: "GET",
      url: `/api/saves/${aliceSave.id}`,
      headers: {
        cookie: bobCookie
      }
    });
    expect(bobReadAliceSave.statusCode).toBe(404);

    const bobMutateAliceSave = await app.inject({
      method: "PATCH",
      url: `/api/saves/${aliceSave.id}`,
      headers: {
        cookie: bobCookie
      },
      payload: {
        name: "Not Bob's World"
      }
    });
    expect(bobMutateAliceSave.statusCode).toBe(404);

    const aliceTurnResponse = await app.inject({
      method: "POST",
      url: `/api/saves/${aliceSave.id}/turns`,
      headers: {
        cookie: aliceCookie
      },
      payload: {
        gmInstruction: "让港口的雾气突然变厚。"
      }
    });
    expect(aliceTurnResponse.statusCode).toBe(201);
    const aliceTurnJob = aliceTurnResponse.json<TurnJob>();
    expect(aliceTurnJob.turn?.id).toBeDefined();

    const bobCreateTurn = await app.inject({
      method: "POST",
      url: `/api/saves/${aliceSave.id}/turns`,
      headers: {
        cookie: bobCookie
      },
      payload: {
        gmInstruction: "Bob should not reach this world."
      }
    });
    expect(bobCreateTurn.statusCode).toBe(404);

    const bobReadAliceTurnJob = await app.inject({
      method: "GET",
      url: `/api/turn-jobs/${aliceTurnJob.id}`,
      headers: {
        cookie: bobCookie
      }
    });
    expect(bobReadAliceTurnJob.statusCode).toBe(404);

    const bobAcceptAliceTurn = await app.inject({
      method: "POST",
      url: `/api/turns/${aliceTurnJob.turn?.id}/accept`,
      headers: {
        cookie: bobCookie
      }
    });
    expect(bobAcceptAliceTurn.statusCode).toBe(404);

    const createInput = {
      templateId: "fantasy-frontier",
      name: "Shared Key World",
      premise: "Two users intentionally reuse an idempotency key.",
      characterSeeds: ["Aria", "Borin", "Cato"],
      settings: {
        language: "en",
        turnTimeScale: "scene",
        randomness: 20,
        contentBoundary: "PG-13",
        styleGuide: "consistent"
      },
      idempotencyKey: "shared-create-key"
    };
    const aliceGeneration = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie: aliceCookie
      },
      payload: createInput
    });
    const bobGeneration = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie: bobCookie
      },
      payload: createInput
    });
    expect(aliceGeneration.statusCode).toBe(201);
    expect(bobGeneration.statusCode).toBe(201);
    expect(bobGeneration.json<SaveGenerationJob>().id).not.toBe(aliceGeneration.json<SaveGenerationJob>().id);

    const bobReadAliceGeneration = await app.inject({
      method: "GET",
      url: `/api/save-generation-jobs/${aliceGeneration.json<SaveGenerationJob>().id}`,
      headers: {
        cookie: bobCookie
      }
    });
    expect(bobReadAliceGeneration.statusCode).toBe(404);

    const bobAcceptAliceGeneration = await app.inject({
      method: "POST",
      url: `/api/save-generation-jobs/${aliceGeneration.json<SaveGenerationJob>().id}/accept`,
      headers: {
        cookie: bobCookie
      }
    });
    expect(bobAcceptAliceGeneration.statusCode).toBe(404);

    await app.close();
  });

  it("supports GM, viewer, and player collaboration permissions", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const ownerCookie = await login(app, "owner");
    const gmCookie = await login(app, "gm-user");
    const viewerCookie = await login(app, "viewer-user");
    const playerCookie = await login(app, "player-user");
    const save = await createAcceptedSave(app, ownerCookie, "Collaborative World");
    const playerCharacter = save.characters[0];

    expect(playerCharacter).toBeDefined();

    const gmInvite = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/collaborators`,
      headers: {
        cookie: ownerCookie
      },
      payload: {
        username: "gm-user",
        role: "gm"
      }
    });
    expect(gmInvite.statusCode).toBe(201);
    expect(gmInvite.json<SaveCollaborator>()).toMatchObject({ username: "gm-user", role: "gm" });

    const viewerInvite = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/collaborators`,
      headers: {
        cookie: ownerCookie
      },
      payload: {
        username: "viewer-user",
        role: "viewer"
      }
    });
    expect(viewerInvite.statusCode).toBe(201);

    const playerInvite = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/collaborators`,
      headers: {
        cookie: gmCookie
      },
      payload: {
        username: "player-user",
        role: "player",
        characterId: playerCharacter?.id
      }
    });
    expect(playerInvite.statusCode).toBe(201);
    expect(playerInvite.json<SaveCollaborator>()).toMatchObject({
      username: "player-user",
      role: "player",
      characterId: playerCharacter?.id
    });

    const gmSaves = await app.inject({
      method: "GET",
      url: "/api/saves",
      headers: {
        cookie: gmCookie
      }
    });
    expect(gmSaves.statusCode).toBe(200);
    expect(gmSaves.json<SaveListItem[]>()[0]?.id).toBe(save.id);

    const gmRead = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie: gmCookie
      }
    });
    expect(gmRead.statusCode).toBe(200);
    expect(gmRead.json<Save>().characters[0]?.secrets.length).toBeGreaterThan(0);

    const viewerRead = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie: viewerCookie
      }
    });
    expect(viewerRead.statusCode).toBe(200);

    const viewerEdit = await app.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie: viewerCookie
      },
      payload: {
        name: "Viewer cannot rename"
      }
    });
    expect(viewerEdit.statusCode).toBe(404);

    const playerRead = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie: playerCookie
      }
    });
    expect(playerRead.statusCode).toBe(200);
    const playerView = playerRead.json<Save>();
    expect(playerView.characters.some((character) => character.id === playerCharacter?.id)).toBe(true);
    expect(
      playerView.characters.find((character) => character.id === playerCharacter?.id)?.secrets.length
    ).toBeGreaterThan(0);
    expect(
      playerView.characters
        .filter((character) => character.id !== playerCharacter?.id)
        .every((character) => character.secrets.length === 0 && character.privateMemory.length === 0)
    ).toBe(true);

    const playerEdit = await app.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie: playerCookie
      },
      payload: {
        name: "Player cannot rename"
      }
    });
    expect(playerEdit.statusCode).toBe(404);

    const submittedInput = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/player-inputs`,
      headers: {
        cookie: playerCookie
      },
      payload: {
        intent: "Search the old pier for the missing lantern."
      }
    });
    expect(submittedInput.statusCode).toBe(201);
    expect(submittedInput.json<PlayerInput>()).toMatchObject({
      username: "player-user",
      characterId: playerCharacter?.id,
      status: "pending"
    });

    const viewerInputs = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}/player-inputs`,
      headers: {
        cookie: viewerCookie
      }
    });
    expect(viewerInputs.statusCode).toBe(404);

    const approvedInput = await app.inject({
      method: "POST",
      url: `/api/player-inputs/${submittedInput.json<PlayerInput>().id}/review`,
      headers: {
        cookie: gmCookie
      },
      payload: {
        status: "approved"
      }
    });
    expect(approvedInput.statusCode).toBe(200);
    expect(approvedInput.json<PlayerInput>().status).toBe("approved");

    const gmTurn = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie: gmCookie
      },
      payload: {
        gmInstruction: "Focus on approved player agency."
      }
    });
    expect(gmTurn.statusCode).toBe(201);
    expect(gmTurn.json<TurnJob>().input?.gmInstruction).toContain("Search the old pier");

    const inputsAfterTurn = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}/player-inputs`,
      headers: {
        cookie: gmCookie
      }
    });
    expect(inputsAfterTurn.statusCode).toBe(200);
    expect(inputsAfterTurn.json<PlayerInput[]>()[0]).toMatchObject({
      status: "used",
      turnJobId: gmTurn.json<TurnJob>().id
    });

    await app.close();
  });

  it("never returns the submitted model API key", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);
    const apiKey = "test-secret-api-key-value";

    const updated = await app.inject({
      method: "PUT",
      url: "/api/model-config",
      headers: {
        cookie
      },
      payload: {
        baseUrl: "https://models.example.test/v1",
        model: "fantasy-test-model",
        apiKey
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json<ModelConfig>().hasApiKey).toBe(true);
    expect(updated.json<ModelConfig>().apiKeyTail).toBe("alue");
    expect(JSON.stringify(updated.json())).not.toContain(apiKey);

    const fetched = await app.inject({
      method: "GET",
      url: "/api/model-config",
      headers: {
        cookie
      }
    });

    expect(fetched.statusCode).toBe(200);
    expect(JSON.stringify(fetched.json())).not.toContain(apiKey);

    await app.close();
  });

  it("uses save-level model overrides before global model credentials", async () => {
    const store = new PrototypeStore();
    const seenCredentials: Array<{ model: string; apiKey?: string }> = [];
    const openAiProvider: LlmProvider = {
      probe(input) {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config: {
            baseUrl: input.baseUrl,
            model: input.model,
            hasApiKey: Boolean(input.apiKey),
            ...(input.apiKey ? { apiKeyTail: input.apiKey.slice(-4) } : {})
          },
          latencyMs: 1
        });
      },
      generateJson(input, request) {
        seenCredentials.push({
          model: input.model,
          ...(input.apiKey ? { apiKey: input.apiKey } : {})
        });

        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          output: request.mockOutput,
          latencyMs: 1
        });
      }
    };
    const app = buildApp({
      env,
      store,
      llmService: new LlmService(store, undefined, openAiProvider)
    });
    const cookie = await login(app);
    const firstSave = await createAcceptedSave(app, cookie, "模型覆盖甲");
    const secondSave = await createAcceptedSave(app, cookie, "模型覆盖乙");
    const globalApiKey = "global-secret-api-key-value";
    const saveApiKey = "save-secret-api-key-value";

    const globalConfig = await app.inject({
      method: "PUT",
      url: "/api/model-config",
      headers: {
        cookie
      },
      payload: {
        baseUrl: "https://global.example.test/v1",
        model: "global-model",
        apiKey: globalApiKey
      }
    });
    const firstOverride = await app.inject({
      method: "PUT",
      url: `/api/saves/${firstSave.id}/model-config`,
      headers: {
        cookie
      },
      payload: {
        baseUrl: "https://save.example.test/v1",
        model: "save-model-a",
        apiKey: saveApiKey
      }
    });
    const secondOverride = await app.inject({
      method: "PUT",
      url: `/api/saves/${secondSave.id}/model-config`,
      headers: {
        cookie
      },
      payload: {
        model: "save-model-b"
      }
    });

    expect(globalConfig.statusCode).toBe(200);
    expect(firstOverride.statusCode).toBe(200);
    expect(secondOverride.statusCode).toBe(200);
    expect(firstOverride.json<Save>().modelConfig?.model).toBe("save-model-a");
    expect(firstOverride.json<Save>().modelConfig?.apiKeyTail).toBe("alue");
    expect(secondOverride.json<Save>().modelConfig?.model).toBe("save-model-b");
    expect(secondOverride.json<Save>().modelConfig?.hasApiKey).toBe(false);
    expect(JSON.stringify(firstOverride.json())).not.toContain(saveApiKey);

    const firstTurn = await app.inject({
      method: "POST",
      url: `/api/saves/${firstSave.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        idempotencyKey: "save-model-a-turn"
      }
    });
    const secondTurn = await app.inject({
      method: "POST",
      url: `/api/saves/${secondSave.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        idempotencyKey: "save-model-b-turn"
      }
    });

    expect(firstTurn.statusCode).toBe(201);
    expect(secondTurn.statusCode).toBe(201);
    expect(seenCredentials.at(-2)).toEqual({ model: "save-model-a", apiKey: saveApiKey });
    expect(seenCredentials.at(-1)).toEqual({ model: "save-model-b", apiKey: globalApiKey });
    expect(firstTurn.json<TurnJob>().turn?.callSummary.model).toBe("save-model-a");
    expect(secondTurn.json<TurnJob>().turn?.callSummary.model).toBe("save-model-b");

    await app.inject({
      method: "POST",
      url: `/api/turn-jobs/${firstTurn.json<TurnJob>().id}/cancel`,
      headers: {
        cookie
      }
    });

    const cleared = await app.inject({
      method: "DELETE",
      url: `/api/saves/${firstSave.id}/model-config`,
      headers: {
        cookie
      }
    });
    const fallback = await app.inject({
      method: "GET",
      url: `/api/saves/${firstSave.id}/model-config`,
      headers: {
        cookie
      }
    });
    const fallbackTurn = await app.inject({
      method: "POST",
      url: `/api/saves/${firstSave.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        idempotencyKey: "save-model-global-turn"
      }
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<Save>().modelConfig).toBeUndefined();
    expect(fallback.json<ModelConfig>().model).toBe("global-model");
    expect(fallbackTurn.statusCode).toBe(201);
    expect(seenCredentials.at(-1)).toEqual({ model: "global-model", apiKey: globalApiKey });
    expect(JSON.stringify(fallbackTurn.json())).not.toContain(globalApiKey);
    expect(JSON.stringify(fallbackTurn.json())).not.toContain(saveApiKey);

    await app.close();
  });

  it("probes mock models without a real API key", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);

    const probe = await app.inject({
      method: "POST",
      url: "/api/model-config/probe",
      headers: {
        cookie
      },
      payload: {
        baseUrl: "https://models.example.test/v1",
        model: "mock-model"
      }
    });

    expect(probe.statusCode).toBe(200);
    expect(probe.json<ModelProbeResult>().ok).toBe(true);
    expect(probe.json<ModelProbeResult>().provider).toBe("mock");

    await app.close();
  });

  it("returns stable probe failures without saving a bad API key", async () => {
    const store = new PrototypeStore();
    const failingProvider: LlmProvider = {
      probe(input): Promise<ModelProbeResult> {
        const config: ModelProbeResult["config"] = {
          baseUrl: input.baseUrl,
          model: input.model,
          hasApiKey: Boolean(input.apiKey),
          supportsJsonMode: false,
          supportsUsage: false,
          supportsStream: false
        };

        if (input.apiKey) {
          config.apiKeyTail = input.apiKey.slice(-4);
        }

        return Promise.resolve({
          ok: false,
          provider: "openai-compatible",
          config,
          latencyMs: 1,
          error: {
            code: "invalid_api_key",
            message: "The model provider rejected the API key"
          }
        });
      },
      generateJson() {
        return Promise.resolve({
          ok: false,
          provider: "openai-compatible",
          latencyMs: 1,
          error: {
            code: "invalid_api_key",
            message: "The model provider rejected the API key"
          }
        });
      }
    };
    const app = buildApp({
      env,
      store,
      llmService: new LlmService(store, undefined, failingProvider)
    });
    const cookie = await login(app);
    const apiKey = "test-secret-api-key-value";

    const probe = await app.inject({
      method: "POST",
      url: "/api/model-config/probe",
      headers: {
        cookie
      },
      payload: {
        baseUrl: "https://models.example.test/v1",
        model: "bad-model",
        apiKey
      }
    });

    expect(probe.statusCode).toBe(200);
    expect(probe.json<ModelProbeResult>().ok).toBe(false);
    expect(probe.json<ModelProbeResult>().error?.code).toBe("invalid_api_key");
    expect(JSON.stringify(probe.json())).not.toContain(apiKey);
    expect(store.getModelConfig().hasApiKey).toBe(false);

    await app.close();
  });
});

describe("FantasyWorld API prototype", () => {
  it("returns stable boundary errors for missing resources and invalid bodies", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);

    const missingSave = await app.inject({
      method: "GET",
      url: "/api/saves/missing-save",
      headers: {
        cookie
      }
    });

    expect(missingSave.statusCode).toBe(404);
    expect(missingSave.json<{ error: { code: string } }>().error.code).toBe("not_found");

    const invalidBody = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload: {
        templateId: "fantasy-frontier",
        name: "",
        premise: "",
        characterSeeds: ["Only one"],
        settings: {
          language: "zh",
          turnTimeScale: "一幕",
          randomness: 25,
          contentBoundary: "PG-13",
          styleGuide: "一致性优先"
        }
      }
    });

    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json<{ error: { code: string } }>().error.code).toBe("validation_error");

    const unauthorizedModelConfig = await app.inject({
      method: "GET",
      url: "/api/model-config"
    });

    expect(unauthorizedModelConfig.statusCode).toBe(401);

    await app.close();
  });

  it("generates localized template drafts without listing them before acceptance", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);
    const worldName = "Archive Finals";

    const generation = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload: {
        templateId: "arcane-academy",
        name: worldName,
        premise: "The archive wakes up during finals night.",
        characterSeeds: ["Lan", "Vio", "Frey"],
        settings: {
          language: "en",
          turnTimeScale: "One class period",
          randomness: 35,
          contentBoundary: "PG",
          styleGuide: "Keep wonder high while making rules consistent"
        },
        modelOverride: {
          model: "mock-draft-model"
        }
      }
    });

    expect(generation.statusCode).toBe(201);

    const job = generation.json<SaveGenerationJob>();
    expect(job.draft?.save.locations[0]?.name).toBe("Star Lantern Archive");
    expect(job.draft?.save.characters.map((character) => character.name)).toEqual(["Lan", "Vio", "Frey"]);

    const listBeforeAccept = await app.inject({
      method: "GET",
      url: "/api/saves",
      headers: {
        cookie
      }
    });

    expect(listBeforeAccept.json<SaveListItem[]>()).toEqual([]);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/save-generation-jobs/${job.id}/accept`,
      headers: {
        cookie
      }
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<Save>().locations[0]?.name).toBe("Star Lantern Archive");

    const listAfterAccept = await app.inject({
      method: "GET",
      url: "/api/saves",
      headers: {
        cookie
      }
    });

    expect(listAfterAccept.json<SaveListItem[]>()).toMatchObject([
      {
        name: worldName,
        characterCount: 3,
        language: "en"
      }
    ]);

    await app.close();
  });

  it("uses structured LLM output for save generation when a model API key is configured", async () => {
    const store = new PrototypeStore();
    store.updateModelConfig({
      model: "story-model",
      apiKey: "test-secret-api-key-value",
      inputTokenPriceUsdPerMillion: 2,
      outputTokenPriceUsdPerMillion: 8
    });
    let calls = 0;
    let userPrompt = "";
    const openAiProvider: LlmProvider = {
      probe() {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config: {
            baseUrl: "https://api.openai.com/v1",
            model: "story-model",
            hasApiKey: true,
            apiKeyTail: "alue"
          },
          latencyMs: 1
        });
      },
      generateJson(_input, request) {
        calls += 1;
        userPrompt = request.userPrompt;

        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          output: {
            description: "A city whose clocks predict disasters before they happen.",
            worldSummary: "Clockwork Harbor is tense, prophetic, and divided by who controls the bells.",
            locations: [
              {
                name: "Clockwork Harbor",
                description: "A port of brass towers, tide engines, and omen bells.",
                status: "The warning bells are ringing early."
              }
            ],
            characters: [
              {
                name: "Ada",
                profile: "A bellwright trying to prove the clocks are being sabotaged.",
                personality: "Precise, stubborn, and quietly compassionate",
                longTermGoal: "Protect the harbor from false prophecies",
                shortTermGoal: "Find the sabotaged bell",
                locationName: "Clockwork Harbor",
                status: "Following a false alarm",
                secrets: ["Knows one bell has a hidden manual override"],
                privateMemory: ["Heard the ninth bell ring before sunrise"]
              },
              {
                name: "Bryn",
                profile: "A dock negotiator hiding debts to the bell guild.",
                personality: "Charming, evasive, and pragmatic",
                longTermGoal: "Escape the guild's leverage",
                shortTermGoal: "Keep shipments moving",
                locationName: "Clockwork Harbor",
                status: "Stalling angry captains",
                secrets: ["Owes the guild a dangerous favor"],
                privateMemory: ["Saw a guild seal on the broken crate"]
              },
              {
                name: "Cato",
                profile: "A young oracle who distrusts mechanical prophecy.",
                personality: "Bold, suspicious, and idealistic",
                longTermGoal: "Free the city from machine omens",
                shortTermGoal: "Expose the next false warning",
                locationName: "Clockwork Harbor",
                status: "Watching the bell tower",
                secrets: ["Can hear a human voice under the bells"],
                privateMemory: ["Dreamed of the harbor flooding backward"]
              }
            ],
            relationships: [
              {
                sourceCharacterName: "Ada",
                targetCharacterName: "Bryn",
                label: "Uneasy allies",
                strength: 42,
                summary: "They need each other, but both suspect the other is hiding guild ties."
              }
            ]
          },
          usage: {
            inputTokens: 100,
            outputTokens: 300,
            totalTokens: 400
          },
          latencyMs: 1
        });
      }
    };
    const app = buildApp({
      env,
      store,
      llmService: new LlmService(store, undefined, openAiProvider)
    });
    const cookie = await login(app);
    const payload = {
      templateId: "fantasy-frontier",
      name: "Clockwork Harbor",
      premise: "Omen clocks predict disasters too accurately.",
      characterSeeds: ["Ada", "Bryn", "Cato"],
      settings: {
        language: "en" as const,
        turnTimeScale: "One scene",
        randomness: 30,
        contentBoundary: "PG",
        styleGuide: "Make prophecy feel mechanical and political"
      },
      idempotencyKey: "llm-world-generation"
    };

    const generation = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload
    });

    expect(generation.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(201);
    expect(calls).toBe(1);
    expect(userPrompt).toContain("Clockwork Harbor");

    const job = generation.json<SaveGenerationJob>();
    const duplicateJob = duplicate.json<SaveGenerationJob>();
    expect(duplicateJob.id).toBe(job.id);
    expect(job.draft?.save.description).toBe("A city whose clocks predict disasters before they happen.");
    expect(job.draft?.save.worldMemory.worldSummary).toContain("prophetic");
    expect(job.draft?.save.locations[0]?.name).toBe("Clockwork Harbor");
    expect(job.draft?.save.characters.map((character) => character.name)).toEqual(["Ada", "Bryn", "Cato"]);
    expect(job.draft?.save.relationships[0]?.label).toBe("Uneasy allies");
    expect(job.llmCall).toMatchObject({
      provider: "openai-compatible",
      model: "story-model",
      status: "succeeded",
      inputTokens: 100,
      outputTokens: 300,
      totalTokens: 400,
      estimatedTokens: 400,
      latencyMs: 1,
      estimatedCostUsd: 0.0026
    });
    expect(JSON.stringify(job)).not.toContain("test-secret-api-key-value");

    await app.close();
  });

  it("keeps invalid structured LLM save drafts as retryable failed jobs", async () => {
    const store = new PrototypeStore();
    store.updateModelConfig({
      model: "story-model",
      apiKey: "test-secret-api-key-value"
    });
    let calls = 0;
    const payload = {
      templateId: "fantasy-frontier",
      name: "Broken Draft",
      premise: "The model returns an invalid world.",
      characterSeeds: ["Ada", "Bryn", "Cato"],
      settings: {
        language: "en" as const,
        turnTimeScale: "One scene",
        randomness: 30,
        contentBoundary: "PG",
        styleGuide: "Keep it coherent"
      },
      idempotencyKey: "failed-world-generation"
    };
    const openAiProvider: LlmProvider = {
      probe() {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config: {
            baseUrl: "https://api.openai.com/v1",
            model: "story-model",
            hasApiKey: true
          },
          latencyMs: 1
        });
      },
      generateJson() {
        calls += 1;

        if (calls > 1) {
          return Promise.resolve({
            ok: true,
            provider: "openai-compatible",
            output: buildGeneratedWorldDraft(payload),
            latencyMs: 1
          });
        }

        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          output: {
            description: "Too small",
            worldSummary: "Missing playable cast",
            locations: [],
            characters: [],
            relationships: []
          },
          latencyMs: 1
        });
      }
    };
    const app = buildApp({
      env,
      store,
      llmService: new LlmService(store, undefined, openAiProvider)
    });
    const cookie = await login(app);

    const generation = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload
    });
    const saves = await app.inject({
      method: "GET",
      url: "/api/saves",
      headers: {
        cookie
      }
    });

    expect(generation.statusCode).toBe(201);
    const failedJob = generation.json<SaveGenerationJob>();
    expect(failedJob.status).toBe("failed");
    expect(failedJob.failure?.code).toBe("schema_validation_failed");
    expect(failedJob.phase).toBe("generating_world_draft");
    expect(failedJob.draft).toBeUndefined();
    expect(saves.json<SaveListItem[]>()).toEqual([]);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload
    });

    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json<SaveGenerationJob>().id).toBe(failedJob.id);
    expect(calls).toBe(1);

    const retried = await app.inject({
      method: "POST",
      url: `/api/save-generation-jobs/${failedJob.id}/retry`,
      headers: {
        cookie
      }
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json<SaveGenerationJob>().status).toBe("needs_review");
    expect(retried.json<SaveGenerationJob>().draft?.save.name).toBe("Broken Draft");
    expect(calls).toBe(2);

    await app.close();
  });

  it("stores provider JSON failures as failed generation jobs with raw output summaries", async () => {
    const store = new PrototypeStore();
    store.updateModelConfig({
      model: "story-model",
      apiKey: "test-secret-api-key-value"
    });
    const openAiProvider: LlmProvider = {
      probe() {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config: {
            baseUrl: "https://api.openai.com/v1",
            model: "story-model",
            hasApiKey: true
          },
          latencyMs: 1
        });
      },
      generateJson() {
        return Promise.resolve({
          ok: false,
          provider: "openai-compatible",
          rawOutput: `{ "description": "${"broken ".repeat(240)}"`,
          error: {
            code: "invalid_json",
            message: "The model returned invalid JSON"
          },
          latencyMs: 1
        });
      }
    };
    const app = buildApp({
      env,
      store,
      llmService: new LlmService(store, undefined, openAiProvider)
    });
    const cookie = await login(app);

    const generation = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload: {
        templateId: "fantasy-frontier",
        name: "Broken JSON",
        premise: "The model returns malformed JSON.",
        characterSeeds: ["Ada", "Bryn", "Cato"],
        settings: {
          language: "en",
          turnTimeScale: "One scene",
          randomness: 30,
          contentBoundary: "PG",
          styleGuide: "Keep it coherent"
        }
      }
    });

    expect(generation.statusCode).toBe(201);
    const job = generation.json<SaveGenerationJob>();
    expect(job.status).toBe("failed");
    expect(job.failure?.code).toBe("invalid_json");
    expect(job.failure?.provider).toBe("openai-compatible");
    expect(job.failure?.rawOutputSummary?.length).toBeLessThanOrEqual(1_003);
    expect(job.failure?.rawOutputSummary).toContain("broken");

    await app.close();
  });

  it("rejects save drafts outside the 3 to 8 character range", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);

    for (const characterSeeds of [
      ["A", "B"],
      ["A", "B", "C", "D", "E", "F", "G", "H", "I"]
    ]) {
      const generation = await app.inject({
        method: "POST",
        url: "/api/save-generation-jobs",
        headers: {
          cookie
        },
        payload: {
          templateId: "fantasy-frontier",
          name: "Invalid cast",
          premise: "Too many or too few people.",
          characterSeeds,
          settings: {
            language: "en",
            turnTimeScale: "One scene",
            randomness: 25,
            contentBoundary: "PG-13",
            styleGuide: "Test"
          }
        }
      });

      expect(generation.statusCode).toBe(400);
    }

    await app.close();
  });

  it("recovers, streams, cancels, and retries generation jobs", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);
    const payload = {
      templateId: "fantasy-frontier",
      name: "Recoverable draft",
      premise: "A draft should survive refresh before acceptance.",
      characterSeeds: ["A", "B", "C"],
      idempotencyKey: "generation-recovery",
      settings: {
        language: "en" as const,
        turnTimeScale: "One scene",
        randomness: 25,
        contentBoundary: "PG-13",
        styleGuide: "Test"
      }
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload
    });

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json<SaveGenerationJob>().id).toBe(first.json<SaveGenerationJob>().id);

    const jobId = first.json<SaveGenerationJob>().id;
    const restored = await app.inject({
      method: "GET",
      url: `/api/save-generation-jobs/${jobId}`,
      headers: {
        cookie
      }
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json<SaveGenerationJob>().phase).toBe("ready_for_review");

    const events = await app.inject({
      method: "GET",
      url: `/api/save-generation-jobs/${jobId}/events`,
      headers: {
        cookie
      }
    });

    expect(events.statusCode).toBe(200);
    expect(events.payload).toContain("event: snapshot");
    expect(events.payload).toContain("event: final");
    expect(events.payload).toContain(jobId);

    const listBeforeAccept = await app.inject({
      method: "GET",
      url: "/api/saves",
      headers: {
        cookie
      }
    });

    expect(listBeforeAccept.json<SaveListItem[]>()).toEqual([]);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/save-generation-jobs/${jobId}/cancel`,
      headers: {
        cookie
      }
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<SaveGenerationJob>().status).toBe("cancelled");

    const retried = await app.inject({
      method: "POST",
      url: `/api/save-generation-jobs/${jobId}/retry`,
      headers: {
        cookie
      }
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json<SaveGenerationJob>().status).toBe("needs_review");
    expect(retried.json<SaveGenerationJob>().id).toBe(jobId);

    await app.close();
  });

  it("deduplicates active turn jobs and can cancel then retry them", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);
    const save = await createAcceptedSave(app, cookie, "任务系统测试");
    const payload = {
      gmInstruction: "让钟楼突然停摆",
      idempotencyKey: "turn-recovery"
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload
    });
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload
    });

    const competing = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        gmInstruction: "尝试并发推进",
        idempotencyKey: "turn-competing"
      }
    });

    expect(first.statusCode).toBe(201);
    expect(duplicate.json<TurnJob>().id).toBe(first.json<TurnJob>().id);
    expect(competing.json<TurnJob>().id).toBe(first.json<TurnJob>().id);

    const jobId = first.json<TurnJob>().id;
    const restored = await app.inject({
      method: "GET",
      url: `/api/turn-jobs/${jobId}`,
      headers: {
        cookie
      }
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json<TurnJob>().phase).toBe("ready_for_review");

    const saveWithDraft = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie
      }
    });

    expect(saveWithDraft.json<Save>().turns).toHaveLength(0);
    expect(saveWithDraft.json<Save>().turnNumber).toBe(0);
    expect(restored.json<TurnJob>().turn?.turnNumber).toBe(1);
    expect(restored.json<TurnJob>().draftState?.characterUpdates.length).toBeGreaterThan(0);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/turn-jobs/${jobId}/cancel`,
      headers: {
        cookie
      }
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<TurnJob>().status).toBe("cancelled");

    const saveAfterCancel = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie
      }
    });

    expect(saveAfterCancel.json<Save>().turns).toHaveLength(0);
    expect(saveAfterCancel.json<Save>().turnNumber).toBe(0);

    const retried = await app.inject({
      method: "POST",
      url: `/api/turn-jobs/${jobId}/retry`,
      headers: {
        cookie
      }
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json<TurnJob>().id).toBe(jobId);
    expect(retried.json<TurnJob>().turn?.turnNumber).toBe(1);

    const saveAfterRetry = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie
      }
    });

    expect(saveAfterRetry.json<Save>().turns).toHaveLength(0);
    expect(saveAfterRetry.json<Save>().turnNumber).toBe(0);

    await app.close();
  });

  it("uses structured LLM output for turn generation when a model API key is configured", async () => {
    const store = new PrototypeStore();
    let calls = 0;
    let userPrompt = "";
    const openAiProvider: LlmProvider = {
      probe() {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config: {
            baseUrl: "https://api.openai.com/v1",
            model: "turn-model",
            hasApiKey: true,
            apiKeyTail: "alue"
          },
          latencyMs: 1
        });
      },
      generateJson(_input, request) {
        calls += 1;
        userPrompt = request.userPrompt;

        const focus = sourceSave.characters[0]!;
        const location = sourceSave.locations[0]!;
        const relationship = sourceSave.relationships[0];
        const output: TurnOrchestrationOutput = {
          focus: {
            characterIds: [focus.id],
            locationId: location.id,
            conflict: "灯塔发出异常信号",
            gmInstruction: "让灯塔发出异常信号"
          },
          characterPlans: [
            {
              characterId: focus.id,
              intention: "确认信号是否来自旧王国的密令",
              action: "登上灯塔并截住守灯人的证词",
              referencedGoal: focus.shortTermGoal,
              referencedMemory: focus.privateMemory[0] ?? "初始记忆",
              referencedSecret: focus.secrets[0] ?? "隐藏线索",
              dialogue: "这不是普通的雾灯，我要知道是谁改了信号。"
            }
          ],
          event: {
            title: "LLM 推演的灯塔异动",
            body: "真实模型分支让灯塔信号改变港口局势。",
            dialogue: [
              {
                characterId: focus.id,
                line: "这不是普通的雾灯，我要知道是谁改了信号。"
              }
            ]
          },
          stateChanges: [
            {
              targetType: "worldMemory",
              field: "timeline",
              before: `${sourceSave.worldMemory.timeline.length} entries`,
              after: `${sourceSave.worldMemory.timeline.length + 1} entries`
            },
            {
              targetType: "character",
              targetId: focus.id,
              field: "status",
              before: focus.status,
              after: "追查 LLM 灯塔信号"
            }
          ],
          memoryUpdates: [
            {
              characterId: focus.id,
              entry: "LLM 回合记忆：灯塔信号被人为改写。"
            }
          ],
          relationshipUpdates: relationship
            ? [
                {
                  relationshipId: relationship.id,
                  strengthDelta: 4,
                  summary: "LLM 回合让两人的互信围绕灯塔线索升温。"
                }
              ]
            : [],
          worldMemory: {
            timelineEntry: "1. LLM 推演的灯塔异动：真实模型分支让灯塔信号改变港口局势。",
            summaryDelta: "LLM 回合把灯塔异常信号加入世界局势。"
          }
        };

        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          output,
          usage: {
            inputTokens: 210,
            outputTokens: 260,
            totalTokens: 470
          },
          latencyMs: 2
        });
      }
    };
    const app = buildApp({
      env,
      store,
      llmService: new LlmService(store, undefined, openAiProvider)
    });
    const cookie = await login(app);
    const sourceSave = await createAcceptedSave(app, cookie, "LLM 回合测试");
    const save = sourceSave;
    store.updateModelConfig({
      model: "turn-model",
      apiKey: "test-secret-api-key-value",
      inputTokenPriceUsdPerMillion: 2,
      outputTokenPriceUsdPerMillion: 4
    });
    const payload = {
      gmInstruction: "让灯塔发出异常信号",
      idempotencyKey: "llm-turn-generation"
    };

    const turn = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload
    });
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload
    });

    expect(turn.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(201);
    expect(calls).toBe(1);
    expect(userPrompt).toContain("让灯塔发出异常信号");
    expect(userPrompt).toContain(save.characters[0]?.name);

    const job = turn.json<TurnJob>();
    const duplicateJob = duplicate.json<TurnJob>();
    const turnId = job.turn?.id;

    expect(duplicateJob.id).toBe(job.id);
    expect(job.turn?.events[0]?.title).toBe("LLM 推演的灯塔异动");
    expect(job.turn?.events[0]?.body).toContain("真实模型分支");
    expect(job.turn?.events[0]?.dialogue?.[0]?.line).toContain("雾灯");
    expect(job.llmCall).toMatchObject({
      provider: "openai-compatible",
      model: "turn-model",
      status: "succeeded",
      inputTokens: 210,
      outputTokens: 260,
      totalTokens: 470,
      estimatedTokens: 470,
      latencyMs: 2,
      estimatedCostUsd: 0.00146
    });
    expect(job.turn?.callSummary).toMatchObject({
      provider: "openai-compatible",
      status: "succeeded",
      inputTokens: 210,
      outputTokens: 260,
      totalTokens: 470,
      estimatedTokens: 470,
      durationMs: 2,
      estimatedCostUsd: 0.00146
    });
    expect(job.draftState?.characterUpdates[0]?.privateMemory).toContain("LLM 回合记忆：灯塔信号被人为改写。");
    expect(job.draftState?.relationshipUpdates[0]?.summary).toContain("LLM 回合");
    expect(JSON.stringify(job)).not.toContain("test-secret-api-key-value");

    if (!turnId) {
      throw new Error("Missing LLM turn id");
    }

    const saveBeforeAccept = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie
      }
    });

    expect(saveBeforeAccept.json<Save>().turns).toHaveLength(0);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/turns/${turnId}/accept`,
      headers: {
        cookie
      }
    });

    expect(accepted.statusCode).toBe(200);
    const acceptedSave = accepted.json<Save>();
    expect(acceptedSave.turnNumber).toBe(1);
    expect(acceptedSave.turns[0]?.events[0]?.title).toBe("LLM 推演的灯塔异动");
    expect(acceptedSave.characters[0]?.privateMemory).toContain("LLM 回合记忆：灯塔信号被人为改写。");
    expect(acceptedSave.relationships[0]?.summary).toContain("LLM 回合");
    expect(acceptedSave.worldMemory.worldSummary).toContain("LLM 回合把灯塔异常信号加入世界局势");

    await app.close();
  });

  it("runs save generation jobs through the background worker", async () => {
    const store = new PrototypeStore();
    store.updateModelConfig({
      model: "worker-world-model",
      apiKey: "test-secret-api-key-value"
    });
    let calls = 0;
    const openAiProvider: LlmProvider = {
      probe() {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config: {
            baseUrl: "https://api.openai.com/v1",
            model: "worker-world-model",
            hasApiKey: true
          },
          latencyMs: 1
        });
      },
      generateJson(_input, request) {
        calls += 1;
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          output: request.mockOutput,
          latencyMs: 1
        });
      }
    };
    const app = buildApp({
      env,
      store,
      llmService: new LlmService(store, undefined, openAiProvider),
      jobExecution: "background"
    });
    const cookie = await login(app);
    const payload = {
      templateId: "fantasy-frontier",
      name: "Worker Harbor",
      premise: "A harbor tests queued world generation.",
      characterSeeds: ["Ada", "Bryn", "Cato"],
      settings: {
        language: "en" as const,
        turnTimeScale: "One scene",
        randomness: 20,
        contentBoundary: "PG",
        styleGuide: "Clear and direct"
      },
      idempotencyKey: "worker-world"
    };

    const queued = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie
      },
      payload
    });

    expect(queued.statusCode).toBe(201);
    expect(queued.json<SaveGenerationJob>().status).toBe("queued");
    expect(duplicate.json<SaveGenerationJob>().id).toBe(queued.json<SaveGenerationJob>().id);

    const completed = await waitForGenerationJob(app, cookie, queued.json<SaveGenerationJob>().id, "needs_review");
    expect(completed.draft?.save.name).toBe("Worker Harbor");
    expect(completed.llmCall?.status).toBe("succeeded");
    expect(calls).toBe(1);

    await app.close();
  });

  it("runs turn jobs through the background worker and keeps one active turn per save", async () => {
    const store = new PrototypeStore();
    const save = store.importSave(
      buildSave({
        templateId: "fantasy-frontier",
        name: "Worker Turn Harbor",
        premise: "A harbor tests queued turn generation.",
        characterSeeds: ["Ada", "Bryn", "Cato"],
        settings: {
          language: "en",
          turnTimeScale: "One scene",
          randomness: 20,
          contentBoundary: "PG",
          styleGuide: "Clear and direct"
        }
      })
    );
    store.updateModelConfig({
      model: "worker-turn-model",
      apiKey: "test-secret-api-key-value"
    });
    let releaseGeneration!: (value: Awaited<ReturnType<LlmProvider["generateJson"]>>) => void;
    const pendingGeneration = new Promise<Awaited<ReturnType<LlmProvider["generateJson"]>>>((resolve) => {
      releaseGeneration = resolve;
    });
    let calls = 0;
    const openAiProvider: LlmProvider = {
      probe() {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config: {
            baseUrl: "https://api.openai.com/v1",
            model: "worker-turn-model",
            hasApiKey: true
          },
          latencyMs: 1
        });
      },
      generateJson(_input, request) {
        calls += 1;
        return pendingGeneration.then(() => ({
          ok: true,
          provider: "openai-compatible",
          output: request.mockOutput,
          latencyMs: 1
        }));
      }
    };
    const app = buildApp({
      env,
      store,
      llmService: new LlmService(store, undefined, openAiProvider),
      jobExecution: "background"
    });
    const cookie = await login(app);

    const first = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        gmInstruction: "Advance in the worker",
        idempotencyKey: "worker-turn-first"
      }
    });
    const running = await waitForTurnJob(app, cookie, first.json<TurnJob>().id, "running");
    const competing = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        gmInstruction: "This should reuse the active job",
        idempotencyKey: "worker-turn-second"
      }
    });

    expect(first.statusCode).toBe(201);
    expect(first.json<TurnJob>().status).toBe("queued");
    expect(running.status).toBe("running");
    expect(competing.json<TurnJob>().id).toBe(first.json<TurnJob>().id);
    expect(calls).toBe(1);

    releaseGeneration({
      ok: true,
      provider: "openai-compatible",
      output: createTurnOrchestration(save, { gmInstruction: "Advance in the worker" }),
      latencyMs: 1
    });

    const completed = await waitForTurnJob(app, cookie, first.json<TurnJob>().id, "needs_review");
    expect(completed.turn?.callSummary.provider).toBe("openai-compatible");
    expect(completed.turn?.callSummary.calls).toBe(1);

    await app.close();
  });

  it("keeps invalid LLM turn references as retryable failed jobs", async () => {
    const store = new PrototypeStore();
    let calls = 0;
    const turnInput = {
      gmInstruction: "让模型返回坏结构",
      idempotencyKey: "invalid-llm-turn"
    };
    const openAiProvider: LlmProvider = {
      probe() {
        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          config: {
            baseUrl: "https://api.openai.com/v1",
            model: "turn-model",
            hasApiKey: true,
            apiKeyTail: "alue"
          },
          latencyMs: 1
        });
      },
      generateJson() {
        calls += 1;

        if (calls > 1) {
          return Promise.resolve({
            ok: true,
            provider: "openai-compatible",
            output: createTurnOrchestration(save, turnInput),
            latencyMs: 1
          });
        }

        return Promise.resolve({
          ok: true,
          provider: "openai-compatible",
          output: {
            focus: {
              characterIds: ["character_missing"],
              locationId: save.locations[0]?.id,
              conflict: "模型编造了不存在的角色"
            },
            characterPlans: [
              {
                characterId: "character_missing",
                intention: "推进不存在角色的目标",
                action: "让不存在角色改变世界",
                referencedGoal: "不存在的目标"
              }
            ],
            event: {
              title: "未知角色行动",
              body: "模型返回了格式正确但引用不存在 ID 的回合。",
              dialogue: [
                {
                  characterId: "character_missing",
                  line: "我不应该进入正式世界。"
                }
              ]
            },
            stateChanges: [
              {
                targetType: "character",
                targetId: "character_missing",
                field: "status",
                before: "missing",
                after: "invalid"
              }
            ],
            memoryUpdates: [
              {
                characterId: "character_missing",
                entry: "不存在角色的记忆"
              }
            ],
            relationshipUpdates: [],
            worldMemory: {
              timelineEntry: "1. 未知角色行动：模型返回了格式正确但引用不存在 ID 的回合。",
              summaryDelta: "未知 ID 不应污染世界。"
            }
          },
          latencyMs: 1
        });
      }
    };
    const app = buildApp({
      env,
      store,
      llmService: new LlmService(store, undefined, openAiProvider)
    });
    const cookie = await login(app);
    const save = await createAcceptedSave(app, cookie, "坏回合测试");
    store.updateModelConfig({
      model: "turn-model",
      apiKey: "test-secret-api-key-value"
    });

    const turn = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: turnInput
    });
    const saveAfterFailure = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie
      }
    });

    expect(turn.statusCode).toBe(201);
    const failedJob = turn.json<TurnJob>();
    expect(failedJob.status).toBe("failed");
    expect(failedJob.failure?.code).toBe("invalid_llm_reference");
    expect(failedJob.phase).toBe("validating_turn_references");
    expect(calls).toBe(1);
    expect(saveAfterFailure.json<Save>().turns).toHaveLength(0);
    expect(saveAfterFailure.json<Save>().turnNumber).toBe(0);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: turnInput
    });

    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json<TurnJob>().id).toBe(failedJob.id);
    expect(calls).toBe(1);

    const retried = await app.inject({
      method: "POST",
      url: `/api/turn-jobs/${failedJob.id}/retry`,
      headers: {
        cookie
      }
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json<TurnJob>().status).toBe("needs_review");
    expect(retried.json<TurnJob>().turn?.turnNumber).toBe(1);
    expect(calls).toBe(2);

    await app.close();
  });

  it("creates a save draft, accepts it, and advances one turn", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);
    const save = await createAcceptedSave(app, cookie);
    expect(save.characters.length).toBe(3);

    const turn = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        gmInstruction: "让一艘陌生船只抵达港口",
        idempotencyKey: "test-turn"
      }
    });

    expect(turn.statusCode).toBe(201);
    const turnBody = turn.json<{ turn: { id: string; turnNumber: number; status: string } }>();
    expect(turnBody.turn.turnNumber).toBe(1);
    expect(turnBody.turn.status).toBe("needs_review");

    const saveBeforeAccept = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie
      }
    });

    expect(saveBeforeAccept.json<Save>().turns).toHaveLength(0);
    expect(saveBeforeAccept.json<Save>().turnNumber).toBe(0);

    const acceptedTurn = await app.inject({
      method: "POST",
      url: `/api/turns/${turnBody.turn.id}/accept`,
      headers: {
        cookie
      }
    });

    expect(acceptedTurn.statusCode).toBe(200);
    expect(acceptedTurn.json<{ turns: Array<{ status: string }> }>().turns[0]?.status).toBe("accepted");

    const exported = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}/export`,
      headers: {
        cookie
      }
    });

    expect(exported.statusCode).toBe(200);
    const exportedPackage = exported.json<SaveExport>();
    expect(exportedPackage.schemaVersion).toBe("1");
    expect(exportedPackage.save.turnNumber).toBe(1);

    const imported = await app.inject({
      method: "POST",
      url: "/api/saves/import",
      headers: {
        cookie
      },
      payload: exportedPackage
    });

    expect(imported.statusCode).toBe(201);
    expect(imported.json<{ id: string; name: string }>().name).toBe("雾港纪元");

    const importedTurn = await app.inject({
      method: "POST",
      url: `/api/saves/${imported.json<Save>().id}/turns`,
      headers: {
        cookie
      },
      payload: {
        idempotencyKey: "imported-turn"
      }
    });

    expect(importedTurn.statusCode).toBe(201);

    const unsupportedVersion = await app.inject({
      method: "POST",
      url: "/api/saves/import",
      headers: {
        cookie
      },
      payload: {
        schemaVersion: "999",
        save: exportedPackage.save
      }
    });

    expect(unsupportedVersion.statusCode).toBe(400);
    expect(unsupportedVersion.json<{ error: { code: string } }>().error.code).toBe("unsupported_schema_version");

    const missingFields = await app.inject({
      method: "POST",
      url: "/api/saves/import",
      headers: {
        cookie
      },
      payload: {
        schemaVersion: "1",
        save: {
          schemaVersion: "1"
        }
      }
    });

    expect(missingFields.statusCode).toBe(400);
    expect(missingFields.json<{ error: { code: string } }>().error.code).toBe("invalid_save_import");

    const malformedJson = await app.inject({
      method: "POST",
      url: "/api/saves/import",
      headers: {
        cookie,
        "content-type": "application/json"
      },
      payload: "{"
    });

    expect(malformedJson.statusCode).toBe(400);
    expect(malformedJson.json<{ error: { code: string } }>().error.code).toBe("request_error");

    const rollback = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/rollback`,
      headers: {
        cookie
      }
    });

    expect(rollback.statusCode).toBe(200);
    expect(rollback.json<{ turnNumber: number; turns: unknown[] }>().turnNumber).toBe(0);
    expect(rollback.json<{ turns: unknown[] }>().turns.length).toBe(1);

    await app.close();
  });

  it("orchestrates turn focus, character intent, memory, and relationship changes", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);
    const save = await createAcceptedSave(app, cookie, "编排测试");

    const first = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        gmInstruction: "让密探逼近码头",
        idempotencyKey: "orchestration-first"
      }
    });

    expect(first.statusCode).toBe(201);
    const firstJob = first.json<TurnJob>();
    const firstTurn = firstJob.turn;

    expect(firstTurn?.events).toHaveLength(1);
    expect(firstTurn?.events[0]?.body).toContain("让密探逼近码头");
    expect(firstTurn?.events[0]?.body).toContain("角色目标");
    expect(firstTurn?.events[0]?.body).toContain("私有记忆");
    expect(firstTurn?.events[0]?.body).toContain("秘密");
    expect(firstTurn?.events[0]?.dialogue?.length).toBeGreaterThan(0);
    expect(firstTurn?.stateChanges.some((change) => change.targetType === "worldMemory")).toBe(true);
    expect(
      firstTurn?.stateChanges.some((change) => change.targetType === "character" && change.field === "privateMemory")
    ).toBe(true);
    expect(
      firstTurn?.stateChanges.some((change) => change.targetType === "relationship" && change.field === "strength")
    ).toBe(true);
    expect(firstTurn?.callSummary.calls).toBe(1);
    expect(firstTurn?.callSummary.provider).toBe("mock");
    expect(firstTurn?.callSummary.estimatedUsage).toBe(true);
    expect(firstTurn?.callSummary.inputTokens).toBeGreaterThan(0);
    expect(firstTurn?.callSummary.outputTokens).toBeGreaterThan(0);

    const saveAfterFirst = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie
      }
    });
    const firstState = saveAfterFirst.json<Save>();

    expect(firstState.turns).toHaveLength(0);
    expect(firstState.turnNumber).toBe(0);
    expect(firstState.characters[0]?.privateMemory).toEqual(save.characters[0]?.privateMemory);
    expect(firstState.relationships[0]?.summary).toBe(save.relationships[0]?.summary);

    if (!firstTurn) {
      throw new Error("Missing first turn");
    }

    const characterDraft = firstJob.draftState?.characterUpdates.at(1) ?? firstJob.draftState?.characterUpdates[0];
    const relationshipDraft = firstJob.draftState?.relationshipUpdates[0];

    if (!characterDraft) {
      throw new Error("Missing character draft update");
    }

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/turn-jobs/${firstJob.id}/draft`,
      headers: {
        cookie
      },
      payload: {
        event: {
          title: "玩家修正后的回合",
          body: "玩家修正后的事件正文"
        },
        stateChanges: firstTurn.stateChanges.map((change, index) =>
          index === 0 ? { ...change, after: "玩家修正后的时间线" } : change
        ),
        characterUpdates: [
          {
            ...characterDraft,
            shortTermGoal: "追查密探",
            privateMemory: [...(characterDraft.privateMemory ?? []), "玩家改写的私有记忆"]
          }
        ],
        relationshipUpdates: relationshipDraft
          ? [
              {
                ...relationshipDraft,
                strength: 42,
                summary: "玩家改写的关系变化"
              }
            ]
          : []
      }
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json<TurnJob>().turn?.events[0]?.body).toBe("玩家修正后的事件正文");
    expect(patched.json<TurnJob>().turn?.stateChanges[0]?.after).toBe("玩家修正后的时间线");

    const acceptedFirst = await app.inject({
      method: "POST",
      url: `/api/turns/${firstTurn.id}/accept`,
      headers: {
        cookie
      }
    });

    expect(acceptedFirst.statusCode).toBe(200);
    const acceptedState = acceptedFirst.json<Save>();

    expect(acceptedState.turns[0]?.events[0]?.title).toBe("玩家修正后的回合");
    expect(acceptedState.turns[0]?.events[0]?.body).toBe("玩家修正后的事件正文");
    expect(
      acceptedState.characters.find((character) => character.id === characterDraft.characterId)?.privateMemory.at(-1)
    ).toBe("玩家改写的私有记忆");
    expect(
      acceptedState.characters.find((character) => character.id === characterDraft.characterId)?.shortTermGoal
    ).toBe("追查密探");
    if (relationshipDraft) {
      expect(
        acceptedState.relationships.find((relationship) => relationship.id === relationshipDraft.relationshipId)
          ?.summary
      ).toBe("玩家改写的关系变化");
    }

    const second = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        idempotencyKey: "orchestration-second"
      }
    });
    const secondTurn = second.json<TurnJob>().turn;

    expect(second.statusCode).toBe(201);
    expect(secondTurn?.events[0]?.body).toContain("玩家改写的私有记忆");
    expect(secondTurn?.events[0]?.dialogue?.some((line) => line.line.includes("追查密探"))).toBe(true);
    expect(secondTurn?.events[0]?.body).toContain("关系");
    expect(secondTurn?.stateChanges.length).toBeGreaterThan(1);

    await app.inject({
      method: "POST",
      url: `/api/turn-jobs/${second.json<TurnJob>().id}/cancel`,
      headers: {
        cookie
      }
    });

    const rollback = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/rollback`,
      headers: {
        cookie
      }
    });
    const rolledBack = rollback.json<Save>();

    expect(rollback.statusCode).toBe(200);
    expect(rolledBack.turnNumber).toBe(0);
    expect(rolledBack.turns).toHaveLength(1);
    expect(rolledBack.headTurnId).toBeUndefined();
    expect(
      rolledBack.characters.find((character) => character.id === characterDraft.characterId)?.shortTermGoal
    ).not.toBe("追查密探");

    const branch = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        gmInstruction: "从回滚点开新分支",
        idempotencyKey: "orchestration-branch"
      }
    });
    const branchTurn = branch.json<TurnJob>().turn;

    expect(branch.statusCode).toBe(201);
    expect(branchTurn?.turnNumber).toBe(1);
    expect(branchTurn?.parentTurnId).toBeUndefined();
    expect(branchTurn?.branchId).not.toBe(rolledBack.turns[0]?.branchId);

    if (!branchTurn) {
      throw new Error("Missing branch turn");
    }

    const acceptedBranch = await app.inject({
      method: "POST",
      url: `/api/turns/${branchTurn.id}/accept`,
      headers: {
        cookie
      }
    });

    expect(acceptedBranch.statusCode).toBe(200);
    expect(acceptedBranch.json<Save>().turnNumber).toBe(1);
    expect(acceptedBranch.json<Save>().turns).toHaveLength(2);
    expect(acceptedBranch.json<Save>().headTurnId).toBe(branchTurn.id);

    await app.close();
  });

  it("edits world entities and uses edited state in later turns", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });
    const cookie = await login(app);
    const save = await createAcceptedSave(app, cookie, "世界编辑器测试");

    const settings = await app.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}/settings`,
      headers: {
        cookie
      },
      payload: {
        ...save.settings,
        randomness: 67,
        contentBoundary: "PG",
        styleGuide: "编辑器测试风格"
      }
    });

    expect(settings.statusCode).toBe(200);
    expect(settings.json<Save>().settings.randomness).toBe(67);

    const location = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/locations`,
      headers: {
        cookie
      },
      payload: {
        name: "暗潮码头",
        description: "潮声下藏着新的线索",
        status: "开放"
      }
    });

    expect(location.statusCode).toBe(201);
    const locationState = location.json<Save>();
    const newLocation = locationState.locations.find((item) => item.name === "暗潮码头");
    const firstCharacter = locationState.characters[0];
    const secondCharacter = locationState.characters[1];

    if (!newLocation || !firstCharacter || !secondCharacter) {
      throw new Error("Missing edited test fixtures");
    }

    const invalidCharacterPatch = await app.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}/characters/${firstCharacter.id}`,
      headers: {
        cookie
      },
      payload: {
        locationId: "missing-location"
      }
    });

    expect(invalidCharacterPatch.statusCode).toBe(404);

    const emptyCharacterName = await app.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}/characters/${firstCharacter.id}`,
      headers: {
        cookie
      },
      payload: {
        name: ""
      }
    });

    expect(emptyCharacterName.statusCode).toBe(400);
    expect(emptyCharacterName.json<{ error: { code: string } }>().error.code).toBe("validation_error");

    const emptyLocationName = await app.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}/locations/${newLocation.id}`,
      headers: {
        cookie
      },
      payload: {
        name: ""
      }
    });

    expect(emptyLocationName.statusCode).toBe(400);
    expect(emptyLocationName.json<{ error: { code: string } }>().error.code).toBe("validation_error");

    const character = await app.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}/characters/${firstCharacter.id}`,
      headers: {
        cookie
      },
      payload: {
        name: "编辑后的艾琳",
        profile: "编辑后的角色档案",
        personality: "冷静，谨慎",
        longTermGoal: "守住暗潮码头",
        shortTermGoal: "追查编辑后的线索",
        locationId: newLocation.id,
        status: "调查中",
        secrets: ["编辑后的秘密"],
        privateMemory: ["编辑后的私有记忆"]
      }
    });

    expect(character.statusCode).toBe(200);
    expect(character.json<Save>().characters[0]?.name).toBe("编辑后的艾琳");
    expect(character.json<Save>().characters[0]?.locationId).toBe(newLocation.id);

    const extraCharacter = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/characters`,
      headers: {
        cookie
      },
      payload: {
        name: "新增角色",
        profile: "新增角色档案",
        personality: "敏锐",
        longTermGoal: "找到出口",
        shortTermGoal: "建立联系",
        locationId: newLocation.id,
        status: "可行动",
        secrets: ["新增秘密"],
        privateMemory: ["新增记忆"]
      }
    });

    expect(extraCharacter.statusCode).toBe(201);
    const extraCharacterId = extraCharacter.json<Save>().characters.find((item) => item.name === "新增角色")?.id;

    if (!extraCharacterId) {
      throw new Error("Missing extra character id");
    }

    const relationship = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/relationships`,
      headers: {
        cookie
      },
      payload: {
        sourceCharacterId: firstCharacter.id,
        targetCharacterId: secondCharacter.id,
        label: "编辑关系",
        strength: 55,
        summary: "编辑后的关系摘要"
      }
    });

    expect(relationship.statusCode).toBe(201);
    const relationshipId = relationship.json<Save>().relationships.find((item) => item.label === "编辑关系")?.id;

    if (!relationshipId) {
      throw new Error("Missing relationship id");
    }

    const emptyRelationshipLabel = await app.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}/relationships/${relationshipId}`,
      headers: {
        cookie
      },
      payload: {
        label: ""
      }
    });

    expect(emptyRelationshipLabel.statusCode).toBe(400);
    expect(emptyRelationshipLabel.json<{ error: { code: string } }>().error.code).toBe("validation_error");

    const patchedRelationship = await app.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}/relationships/${relationshipId}`,
      headers: {
        cookie
      },
      payload: {
        strength: 61,
        summary: "再次编辑后的关系摘要"
      }
    });

    expect(patchedRelationship.statusCode).toBe(200);
    expect(patchedRelationship.json<Save>().relationships.find((item) => item.id === relationshipId)?.strength).toBe(
      61
    );

    const deletedRelationship = await app.inject({
      method: "DELETE",
      url: `/api/saves/${save.id}/relationships/${relationshipId}`,
      headers: {
        cookie
      }
    });

    expect(deletedRelationship.statusCode).toBe(200);
    expect(deletedRelationship.json<Save>().relationships.some((item) => item.id === relationshipId)).toBe(false);

    const deletedCharacter = await app.inject({
      method: "DELETE",
      url: `/api/saves/${save.id}/characters/${extraCharacterId}`,
      headers: {
        cookie
      }
    });

    expect(deletedCharacter.statusCode).toBe(200);
    expect(deletedCharacter.json<Save>().characters.some((item) => item.id === extraCharacterId)).toBe(false);

    const occupiedLocationDelete = await app.inject({
      method: "DELETE",
      url: `/api/saves/${save.id}/locations/${newLocation.id}`,
      headers: {
        cookie
      }
    });

    expect(occupiedLocationDelete.statusCode).toBe(404);

    const turn = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        idempotencyKey: "world-editor-turn"
      }
    });
    const turnJob = turn.json<TurnJob>();

    expect(turn.statusCode).toBe(201);
    expect(turnJob.turn?.events[0]?.body).toContain("编辑后的私有记忆");
    expect(turnJob.turn?.events[0]?.dialogue?.some((line) => line.line.includes("追查编辑后的线索"))).toBe(true);

    await app.close();
  });
});

const describeDb = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;

describeDb("FantasyWorld API database persistence", () => {
  it("persists saves, edits, turns, rollback snapshots, and imports", async () => {
    const firstRuntime = createDatabaseStore(databaseEnv.databaseUrl, databaseEnv.encryptionKey);
    const dbLlmProvider = new MockLlmProvider();
    const firstApp = buildApp({
      env: databaseEnv,
      store: firstRuntime.store,
      llmService: new LlmService(firstRuntime.store, dbLlmProvider, dbLlmProvider)
    });
    const cookie = await login(firstApp);
    const save = await createAcceptedSave(firstApp, cookie, `持久化测试 ${crypto.randomUUID()}`);
    const apiKey = "test-secret-api-key-value";

    const modelConfig = await firstApp.inject({
      method: "PUT",
      url: "/api/model-config",
      headers: {
        cookie
      },
      payload: {
        model: "db-model",
        apiKey
      }
    });

    expect(modelConfig.statusCode).toBe(200);
    expect(modelConfig.json<ModelConfig>().hasApiKey).toBe(true);
    expect(modelConfig.json<ModelConfig>().apiKeyTail).toBe("alue");
    expect(JSON.stringify(modelConfig.json())).not.toContain(apiKey);

    const pool = new Pool({ connectionString: databaseEnv.databaseUrl });

    try {
      const storedConfig = await pool.query<{
        data: ModelConfig;
        api_key_ciphertext: string | null;
      }>("select data, api_key_ciphertext from model_configs where id = $1", ["global"]);
      const row = storedConfig.rows[0];

      expect(row?.api_key_ciphertext).toBeTypeOf("string");
      expect(row?.data.apiKeyTail).toBe("alue");
      expect(JSON.stringify(row)).not.toContain(apiKey);
    } finally {
      await pool.end();
    }

    const saveApiKey = "test-save-secret-api-key-value";
    const saveModelConfig = await firstApp.inject({
      method: "PUT",
      url: `/api/saves/${save.id}/model-config`,
      headers: {
        cookie
      },
      payload: {
        baseUrl: "https://save-models.example.test/v1",
        model: "db-save-model",
        apiKey: saveApiKey
      }
    });

    expect(saveModelConfig.statusCode).toBe(200);
    expect(saveModelConfig.json<Save>().modelConfig?.model).toBe("db-save-model");
    expect(saveModelConfig.json<Save>().modelConfig?.hasApiKey).toBe(true);
    expect(saveModelConfig.json<Save>().modelConfig?.apiKeyTail).toBe("alue");
    expect(JSON.stringify(saveModelConfig.json())).not.toContain(saveApiKey);

    const saveModelPool = new Pool({ connectionString: databaseEnv.databaseUrl });

    try {
      const storedSaveConfig = await saveModelPool.query<{
        model_config: ModelConfig | null;
        model_api_key_ciphertext: string | null;
      }>("select model_config, model_api_key_ciphertext from saves where id = $1", [save.id]);
      const row = storedSaveConfig.rows[0];

      expect(row?.model_api_key_ciphertext).toBeTypeOf("string");
      expect(row?.model_config?.apiKeyTail).toBe("alue");
      expect(JSON.stringify(row)).not.toContain(saveApiKey);
    } finally {
      await saveModelPool.end();
    }

    const patched = await firstApp.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}`,
      headers: {
        cookie
      },
      payload: {
        name: "持久化测试已更新",
        description: "数据库更新路径验收"
      }
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json<Save>().name).toBe("持久化测试已更新");

    const patchedSave = patched.json<Save>();
    const characterId = patchedSave.characters[0]?.id;
    const characterName = patchedSave.characters[0]?.name;
    if (!characterId) {
      throw new Error("Missing character id");
    }
    if (!characterName) {
      throw new Error("Missing character name");
    }

    const characterPatch = await firstApp.inject({
      method: "PATCH",
      url: `/api/saves/${save.id}/characters/${characterId}`,
      headers: {
        cookie
      },
      payload: {
        status: "调查中"
      }
    });

    expect(characterPatch.statusCode).toBe(200);
    expect(characterPatch.json<Save>().characters.find((character) => character.id === characterId)?.status).toBe(
      "调查中"
    );

    const turn = await firstApp.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        gmInstruction: "让港口议会公开争执",
        idempotencyKey: "db-turn"
      }
    });

    expect(turn.statusCode).toBe(201);
    const turnJob = turn.json<TurnJob>();
    const turnId = turnJob.turn?.id;
    expect(turnJob.turn?.callSummary.model).toBe("db-save-model");

    if (!turnId) {
      throw new Error("Missing turn id");
    }

    const duplicateTurn = await firstApp.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        gmInstruction: "让港口议会公开争执",
        idempotencyKey: "db-turn"
      }
    });
    const competingTurn = await firstApp.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie
      },
      payload: {
        gmInstruction: "尝试并发推进",
        idempotencyKey: "db-turn-competing"
      }
    });

    expect(duplicateTurn.json<TurnJob>().id).toBe(turnJob.id);
    expect(competingTurn.json<TurnJob>().id).toBe(turnJob.id);

    const acceptedTurn = await firstApp.inject({
      method: "POST",
      url: `/api/turns/${turnId}/accept`,
      headers: {
        cookie
      }
    });

    expect(acceptedTurn.statusCode).toBe(200);
    expect(acceptedTurn.json<Save>().turns[0]?.status).toBe("accepted");

    const exported = await firstApp.inject({
      method: "GET",
      url: `/api/saves/${save.id}/export`,
      headers: {
        cookie
      }
    });

    expect(exported.statusCode).toBe(200);
    const exportedPackage = exported.json<SaveExport>();
    const exportedSave = exportedPackage.save;
    expect(exportedPackage.schemaVersion).toBe("1");
    expect(exportedSave.turnNumber).toBe(1);
    expect(exportedSave.turns[0]?.status).toBe("accepted");
    expect(exportedSave.headTurnId).toBe(exportedSave.turns[0]?.id);
    expect(exportedSave.currentBranchId).toBe(exportedSave.turns[0]?.branchId);
    expect(JSON.stringify(exportedPackage)).not.toContain(apiKey);
    expect(JSON.stringify(exportedPackage)).not.toContain(saveApiKey);
    expect(exportedSave.modelConfig?.apiKeyTail).toBe("alue");

    const rollback = await firstApp.inject({
      method: "POST",
      url: `/api/saves/${save.id}/rollback`,
      headers: {
        cookie
      }
    });

    expect(rollback.statusCode).toBe(200);
    expect(rollback.json<Save>().turnNumber).toBe(0);
    expect(rollback.json<Save>().turns.length).toBe(1);

    const imported = await firstApp.inject({
      method: "POST",
      url: "/api/saves/import",
      headers: {
        cookie
      },
      payload: exportedPackage
    });

    expect(imported.statusCode).toBe(201);
    expect(imported.json<Save>().id).not.toBe(save.id);
    expect(imported.json<Save>().turnNumber).toBe(1);
    expect(imported.json<Save>().headTurnId).toBe(imported.json<Save>().turns[0]?.id);
    expect(imported.json<Save>().headTurnId).not.toBe(exportedSave.headTurnId);
    expect(imported.json<Save>().currentBranchId).toBe(exportedSave.currentBranchId);
    expect(imported.json<Save>().modelConfig?.hasApiKey).toBe(false);
    expect(imported.json<Save>().modelConfig?.apiKeyTail).toBeUndefined();

    const clearedModelConfig = await firstApp.inject({
      method: "DELETE",
      url: `/api/saves/${save.id}/model-config`,
      headers: {
        cookie
      }
    });

    expect(clearedModelConfig.statusCode).toBe(200);
    expect(clearedModelConfig.json<Save>().modelConfig).toBeUndefined();

    await firstApp.close();
    await firstRuntime.close();

    const secondRuntime = createDatabaseStore(databaseEnv.databaseUrl, databaseEnv.encryptionKey);
    const secondApp = buildApp({ env: databaseEnv, store: secondRuntime.store });
    const secondCookie = await login(secondApp);
    const importedId = imported.json<Save>().id;
    const restored = await secondRuntime.store.getSave(importedId);

    expect(restored?.id).toBe(importedId);
    expect(restored?.name).toBe("持久化测试已更新");
    expect(restored?.characters.length).toBe(3);
    expect(restored?.characters.find((character) => character.name === characterName)?.status).toBe("调查中");
    expect(restored?.turns[0]?.status).toBe("accepted");
    const restoredDialogueCharacterId = restored?.turns[0]?.events[0]?.dialogue?.[0]?.characterId;
    expect(restoredDialogueCharacterId).toBeDefined();
    expect(restoredDialogueCharacterId).not.toBe(exportedSave.turns[0]?.events[0]?.dialogue?.[0]?.characterId);
    expect(restored?.characters.some((character) => character.id === restoredDialogueCharacterId)).toBe(true);

    const importedRollback = await secondApp.inject({
      method: "POST",
      url: `/api/saves/${importedId}/rollback`,
      headers: {
        cookie: secondCookie
      }
    });

    expect(importedRollback.statusCode).toBe(200);
    expect(importedRollback.json<Save>().turnNumber).toBe(0);
    expect(importedRollback.json<Save>().turns.length).toBe(1);

    await secondApp.close();
    await secondRuntime.close();
  });
});
