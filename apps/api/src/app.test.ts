import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { PrototypeStore } from "./store/prototype-store.js";

const env = loadEnv({
  NODE_ENV: "test",
  SESSION_SECRET: "test-session-secret-test-session-secret",
  ENCRYPTION_KEY: "test-encryption-key"
});

describe("FantasyWorld API prototype", () => {
  it("creates a save draft, accepts it, and advances one turn", async () => {
    const app = buildApp({ env, store: new PrototypeStore() });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "fantasyworld"
      }
    });

    expect(login.statusCode).toBe(200);

    const cookie = login.headers["set-cookie"];

    const generation = await app.inject({
      method: "POST",
      url: "/api/save-generation-jobs",
      headers: {
        cookie: Array.isArray(cookie) ? cookie[0] : cookie
      },
      payload: {
        templateId: "fantasy-frontier",
        name: "雾港纪元",
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
        cookie: Array.isArray(cookie) ? cookie[0] : cookie
      }
    });

    expect(accepted.statusCode).toBe(200);
    const save = accepted.json<{ id: string; characters: unknown[] }>();
    expect(save.characters.length).toBe(3);

    const turn = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/turns`,
      headers: {
        cookie: Array.isArray(cookie) ? cookie[0] : cookie
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
        cookie: Array.isArray(cookie) ? cookie[0] : cookie
      }
    });

    expect(acceptedTurn.statusCode).toBe(200);
    expect(acceptedTurn.json<{ turns: Array<{ status: string }> }>().turns[0]?.status).toBe("accepted");

    const exported = await app.inject({
      method: "GET",
      url: `/api/saves/${save.id}/export`,
      headers: {
        cookie: Array.isArray(cookie) ? cookie[0] : cookie
      }
    });

    expect(exported.statusCode).toBe(200);

    const imported = await app.inject({
      method: "POST",
      url: "/api/saves/import",
      headers: {
        cookie: Array.isArray(cookie) ? cookie[0] : cookie
      },
      payload: exported.json()
    });

    expect(imported.statusCode).toBe(201);
    expect(imported.json<{ id: string; name: string }>().name).toBe("雾港纪元");

    const rollback = await app.inject({
      method: "POST",
      url: `/api/saves/${save.id}/rollback`,
      headers: {
        cookie: Array.isArray(cookie) ? cookie[0] : cookie
      }
    });

    expect(rollback.statusCode).toBe(200);
    expect(rollback.json<{ turnNumber: number; turns: unknown[] }>().turnNumber).toBe(0);
    expect(rollback.json<{ turns: unknown[] }>().turns.length).toBe(0);

    await app.close();
  });
});
