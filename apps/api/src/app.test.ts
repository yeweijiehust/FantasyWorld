import pg from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDatabaseStore } from "./db/client.js";
import { LlmService } from "./llm/service.js";
import type { LlmProvider } from "./llm/types.js";
import { PrototypeStore } from "./store/prototype-store.js";
import type {
  ModelConfig,
  ModelProbeResult,
  Save,
  SaveExport,
  SaveGenerationJob,
  SaveListItem,
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

async function login(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
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
    expect(rollback.json<{ turns: unknown[] }>().turns.length).toBe(0);

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
    expect(firstTurn?.callSummary.calls).toBeGreaterThan(1);

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
    expect(rolledBack.turns).toHaveLength(0);
    expect(
      rolledBack.characters.find((character) => character.id === characterDraft.characterId)?.shortTermGoal
    ).not.toBe("追查密探");

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
    const firstApp = buildApp({ env: databaseEnv, store: firstRuntime.store });
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
    expect(JSON.stringify(exportedPackage)).not.toContain(apiKey);

    const rollback = await firstApp.inject({
      method: "POST",
      url: `/api/saves/${save.id}/rollback`,
      headers: {
        cookie
      }
    });

    expect(rollback.statusCode).toBe(200);
    expect(rollback.json<Save>().turnNumber).toBe(0);
    expect(rollback.json<Save>().turns.length).toBe(0);

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
    expect(importedRollback.json<Save>().turns.length).toBe(0);

    await secondApp.close();
    await secondRuntime.close();
  });
});
