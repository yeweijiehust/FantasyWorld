import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  ApiErrorSchema,
  CharacterPatchSchema,
  CreateSaveInputSchema,
  CreateTurnInputSchema,
  ModelConfigSchema,
  ModelProbeInputSchema,
  ModelProbeResultSchema,
  PatchTurnDraftInputSchema,
  SaveGenerationJobSchema,
  SaveImportSchema,
  SaveListItemSchema,
  SaveSchema,
  SessionSchema,
  TurnJobSchema
} from "@fantasy-world/shared";
import Fastify, { type FastifyError } from "fastify";
import { Type } from "typebox";
import { verifyPassword } from "./auth/password.js";
import type { AppEnv } from "./config/env.js";
import { LlmService } from "./llm/service.js";
import { prototypeStore } from "./store/prototype-store.js";
import type { FantasyWorldStore } from "./store/types.js";

const ParamsWithIdSchema = Type.Object({ id: Type.String() });
const GenerationParamsSchema = Type.Object({ id: Type.String() });
const TurnJobParamsSchema = Type.Object({ id: Type.String() });
const SaveParamsSchema = Type.Object({ id: Type.String() });
const CharacterParamsSchema = Type.Object({ id: Type.String(), characterId: Type.String() });
const LoginBodySchema = Type.Object({
  password: Type.String()
});

const ModelConfigUpdateSchema = Type.Object({
  baseUrl: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  apiKey: Type.Optional(Type.String()),
  supportsJsonMode: Type.Optional(Type.Boolean()),
  supportsUsage: Type.Optional(Type.Boolean()),
  supportsStream: Type.Optional(Type.Boolean())
});

const SavePatchSchema = Type.Partial(
  Type.Object({
    name: Type.String(),
    description: Type.String(),
    settings: SaveSchema.properties.settings,
    worldMemory: SaveSchema.properties.worldMemory
  })
);

type BuildAppOptions = {
  env: AppEnv;
  store?: FantasyWorldStore;
  llmService?: LlmService;
};

export function buildApp(options: BuildAppOptions) {
  const store = options.store ?? prototypeStore;
  const llmService = options.llmService ?? new LlmService(store);
  const logger =
    options.env.nodeEnv === "test"
      ? false
      : options.env.nodeEnv === "development"
        ? { transport: { target: "pino-pretty" } }
        : true;
  const app = Fastify({
    logger
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(statusCode).send({
      error: {
        code: statusCode === 500 ? "internal_error" : "request_error",
        message: statusCode === 500 ? "Unexpected server error" : error.message
      }
    });
  });

  app.register(cors, {
    origin: options.env.nodeEnv === "production" ? false : options.env.webOrigin,
    credentials: true
  });
  app.register(cookie, {
    secret: options.env.sessionSecret
  });
  app.register(swagger, {
    openapi: {
      info: {
        title: "FantasyWorld API",
        version: "0.0.0"
      }
    }
  });
  app.register(swaggerUi, {
    routePrefix: "/docs"
  });

  app.addHook("preHandler", async (request, reply) => {
    if (isPublicPath(request.url)) {
      return;
    }

    if (!(await store.hasSession(request.cookies.fw_session))) {
      return sendError(reply, 401, "unauthorized", "Login required");
    }
  });

  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: Type.Object({ ok: Type.Boolean() })
        }
      }
    },
    () => ({ ok: true })
  );

  app.get(
    "/api/auth/session",
    {
      schema: {
        response: {
          200: SessionSchema
        }
      }
    },
    async (request) => ({ authenticated: await store.hasSession(request.cookies.fw_session) })
  );

  app.post(
    "/api/auth/login",
    {
      schema: {
        body: LoginBodySchema,
        response: {
          200: SessionSchema,
          401: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      if (!verifyPassword(request.body.password, options.env.adminPasswordHash)) {
        return sendError(reply, 401, "invalid_credentials", "Invalid password");
      }

      const sessionId = await store.createSession();

      reply.setCookie("fw_session", sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: options.env.nodeEnv === "production",
        path: "/"
      });

      return { authenticated: true };
    }
  );

  app.post(
    "/api/auth/logout",
    {
      schema: {
        response: {
          200: SessionSchema
        }
      }
    },
    async (request, reply) => {
      const sessionId = request.cookies.fw_session;

      if (sessionId) {
        await store.deleteSession(sessionId);
      }

      reply.clearCookie("fw_session", { path: "/" });
      return { authenticated: false };
    }
  );

  app.get(
    "/api/model-config",
    {
      schema: {
        response: {
          200: ModelConfigSchema
        }
      }
    },
    async () => store.getModelConfig()
  );

  app.put(
    "/api/model-config",
    {
      schema: {
        body: ModelConfigUpdateSchema,
        response: {
          200: ModelConfigSchema
        }
      }
    },
    async (request) => store.updateModelConfig(request.body)
  );

  app.post(
    "/api/model-config/probe",
    {
      schema: {
        body: ModelProbeInputSchema,
        response: {
          200: ModelProbeResultSchema
        }
      }
    },
    async (request) => llmService.probeModel(request.body)
  );

  app.get(
    "/api/saves",
    {
      schema: {
        response: {
          200: Type.Array(SaveListItemSchema)
        }
      }
    },
    async () => store.listSaves()
  );

  app.get(
    "/api/saves/:id",
    {
      schema: {
        params: ParamsWithIdSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.getSave(request.params.id);
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.patch(
    "/api/saves/:id",
    {
      schema: {
        params: SaveParamsSchema,
        body: SavePatchSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.patchSave(request.params.id, request.body);
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.get(
    "/api/saves/:id/world-state",
    {
      schema: {
        params: SaveParamsSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.getSave(request.params.id);
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.get(
    "/api/saves/:id/export",
    {
      schema: {
        params: SaveParamsSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.getSave(request.params.id);
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.post(
    "/api/saves/import",
    {
      schema: {
        body: SaveImportSchema,
        response: {
          201: SaveSchema
        }
      }
    },
    async (request, reply) => {
      reply.code(201);
      return await store.importSave(request.body);
    }
  );

  app.post(
    "/api/saves/:id/rollback",
    {
      schema: {
        params: SaveParamsSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.rollbackSave(request.params.id);
      return save ?? sendError(reply, 404, "not_found", "No rollback snapshot available");
    }
  );

  app.patch(
    "/api/saves/:id/settings",
    {
      schema: {
        params: SaveParamsSchema,
        body: SaveSchema.properties.settings,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.patchSave(request.params.id, { settings: request.body });
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.patch(
    "/api/saves/:id/characters/:characterId",
    {
      schema: {
        params: CharacterParamsSchema,
        body: CharacterPatchSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.patchCharacter(request.params.id, request.params.characterId, request.body);
      return save ?? sendError(reply, 404, "not_found", "Character not found");
    }
  );

  app.patch(
    "/api/saves/:id/world-memory",
    {
      schema: {
        params: SaveParamsSchema,
        body: SaveSchema.properties.worldMemory,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.patchSave(request.params.id, { worldMemory: request.body });
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.post(
    "/api/save-generation-jobs",
    {
      schema: {
        body: CreateSaveInputSchema,
        response: {
          201: SaveGenerationJobSchema
        }
      }
    },
    async (request, reply) => {
      reply.code(201);
      return await store.createGenerationJob(request.body);
    }
  );

  app.get(
    "/api/save-generation-jobs/:id",
    {
      schema: {
        params: GenerationParamsSchema,
        response: {
          200: SaveGenerationJobSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const job = await store.getGenerationJob(request.params.id);
      return job ?? sendError(reply, 404, "not_found", "Generation job not found");
    }
  );

  app.get(
    "/api/save-generation-jobs/:id/events",
    {
      schema: {
        params: GenerationParamsSchema
      }
    },
    async (request, reply) => {
      return sendJobSse(reply, async () => store.getGenerationJob(request.params.id), {
        error: { code: "not_found", message: "Generation job not found" }
      });
    }
  );

  app.post(
    "/api/save-generation-jobs/:id/cancel",
    {
      schema: {
        params: GenerationParamsSchema,
        response: {
          200: SaveGenerationJobSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const job = await store.cancelGenerationJob(request.params.id);
      return job ?? sendError(reply, 404, "not_found", "Generation job not found");
    }
  );

  app.post(
    "/api/save-generation-jobs/:id/retry",
    {
      schema: {
        params: GenerationParamsSchema,
        response: {
          200: SaveGenerationJobSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const job = await store.retryGenerationJob(request.params.id);
      return job ?? sendError(reply, 404, "not_found", "Generation job not found");
    }
  );

  app.post(
    "/api/save-generation-jobs/:id/accept",
    {
      schema: {
        params: GenerationParamsSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.acceptGenerationJob(request.params.id);
      return save ?? sendError(reply, 404, "not_found", "Generation job not found");
    }
  );

  app.post(
    "/api/saves/:id/turns",
    {
      schema: {
        params: SaveParamsSchema,
        body: CreateTurnInputSchema,
        response: {
          201: TurnJobSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const job = await store.createTurnJob(request.params.id, request.body);

      if (!job) {
        return sendError(reply, 404, "not_found", "Save not found");
      }

      reply.code(201);
      return job;
    }
  );

  app.get(
    "/api/turn-jobs/:id",
    {
      schema: {
        params: TurnJobParamsSchema,
        response: {
          200: TurnJobSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const job = await store.getTurnJob(request.params.id);
      return job ?? sendError(reply, 404, "not_found", "Turn job not found");
    }
  );

  app.get(
    "/api/turn-jobs/:id/events",
    {
      schema: {
        params: TurnJobParamsSchema
      }
    },
    async (request, reply) => {
      return sendJobSse(reply, async () => store.getTurnJob(request.params.id), {
        error: { code: "not_found", message: "Turn job not found" }
      });
    }
  );

  app.patch(
    "/api/turn-jobs/:id/draft",
    {
      schema: {
        params: TurnJobParamsSchema,
        body: PatchTurnDraftInputSchema,
        response: {
          200: TurnJobSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const job = await store.patchTurnDraft(request.params.id, request.body);
      return job ?? sendError(reply, 404, "not_found", "Editable turn draft not found");
    }
  );

  app.post(
    "/api/turn-jobs/:id/cancel",
    {
      schema: {
        params: TurnJobParamsSchema,
        response: {
          200: TurnJobSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const job = await store.cancelTurnJob(request.params.id);
      return job ?? sendError(reply, 404, "not_found", "Turn job not found");
    }
  );

  app.post(
    "/api/turn-jobs/:id/retry",
    {
      schema: {
        params: TurnJobParamsSchema,
        response: {
          200: TurnJobSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const job = await store.retryTurnJob(request.params.id);
      return job ?? sendError(reply, 404, "not_found", "Turn job not found");
    }
  );

  app.post(
    "/api/turns/:id/accept",
    {
      schema: {
        params: TurnJobParamsSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const save = await store.acceptTurn(request.params.id);
      return save ?? sendError(reply, 404, "not_found", "Turn not found");
    }
  );

  if (options.env.nodeEnv === "production") {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(dirname, "../../../web/dist");
    app.register(fastifyStatic, {
      root,
      prefix: "/"
    });
    app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));
  }

  return app;
}

function isPublicPath(url: string) {
  return (
    url.startsWith("/api/health") ||
    url.startsWith("/api/auth/login") ||
    url.startsWith("/api/auth/session") ||
    url.startsWith("/docs") ||
    url.startsWith("/documentation")
  );
}

type ReplyWithCode<TStatusCode extends number> = {
  code: (statusCode: TStatusCode) => unknown;
};

type SseReply = {
  raw: {
    writeHead: (statusCode: number, headers: Record<string, string>) => void;
    write: (chunk: string) => void;
    end: () => void;
    on?: (event: "close", listener: () => void) => void;
  };
};

function sendError<TStatusCode extends number>(
  reply: ReplyWithCode<TStatusCode>,
  statusCode: TStatusCode,
  code: string,
  message: string
) {
  reply.code(statusCode);
  return {
    error: {
      code,
      message
    }
  };
}

async function sendJobSse(reply: SseReply, getSnapshot: () => Promise<unknown>, missingPayload: unknown) {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  let closed = false;
  let lastPayload = "";
  reply.raw.on?.("close", () => {
    closed = true;
  });

  for (let attempt = 0; attempt < 40 && !closed; attempt += 1) {
    const payload = (await getSnapshot()) ?? missingPayload;
    const serialized = JSON.stringify(payload);

    if (serialized !== lastPayload) {
      writeSseEvent(reply, "snapshot", payload);
      lastPayload = serialized;
    }

    if (isSseFinalPayload(payload)) {
      writeSseEvent(reply, "final", payload);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  reply.raw.end();
}

function writeSseEvent(reply: SseReply, event: string, payload: unknown) {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function isSseFinalPayload(payload: unknown) {
  const status = (payload as { status?: string }).status;

  return status === "needs_review" || status === "failed" || status === "cancelled" || status === "accepted";
}
