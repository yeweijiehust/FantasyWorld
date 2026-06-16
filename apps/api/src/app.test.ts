import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDatabaseStore } from "./db/client.js";
import { PrototypeStore } from "./store/prototype-store.js";
import type { Save } from "@fantasy-world/shared";

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

  return accepted.json<{ id: string; characters: unknown[] }>();
}

describe("FantasyWorld API prototype", () => {
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

    const imported = await app.inject({
      method: "POST",
      url: "/api/saves/import",
      headers: {
        cookie
      },
      payload: exported.json()
    });

    expect(imported.statusCode).toBe(201);
    expect(imported.json<{ id: string; name: string }>().name).toBe("雾港纪元");

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
});

const describeDb = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;

describeDb("FantasyWorld API database persistence", () => {
  it("persists saves, edits, turns, rollback snapshots, and imports", async () => {
    const firstRuntime = createDatabaseStore(databaseEnv.databaseUrl);
    const firstApp = buildApp({ env: databaseEnv, store: firstRuntime.store });
    const cookie = await login(firstApp);
    const save = await createAcceptedSave(firstApp, cookie, `持久化测试 ${crypto.randomUUID()}`);

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
    const turnId = turn.json<{ turn: { id: string } }>().turn.id;

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
    const exportedSave = exported.json<Save>();
    expect(exportedSave.turnNumber).toBe(1);
    expect(exportedSave.turns[0]?.status).toBe("accepted");

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
      payload: exportedSave
    });

    expect(imported.statusCode).toBe(201);
    expect(imported.json<Save>().id).not.toBe(save.id);
    expect(imported.json<Save>().turnNumber).toBe(1);

    await firstApp.close();
    await firstRuntime.close();

    const secondRuntime = createDatabaseStore(databaseEnv.databaseUrl);
    const secondApp = buildApp({ env: databaseEnv, store: secondRuntime.store });
    const secondCookie = await login(secondApp);
    const importedId = imported.json<Save>().id;
    const restored = await secondRuntime.store.getSave(importedId);

    expect(restored?.id).toBe(importedId);
    expect(restored?.name).toBe("持久化测试已更新");
    expect(restored?.characters.length).toBe(3);
    expect(restored?.characters.find((character) => character.name === characterName)?.status).toBe("调查中");
    expect(restored?.turns[0]?.status).toBe("accepted");

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
