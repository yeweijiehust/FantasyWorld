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
import { prototypeStore, type PrototypeStore } from "./store/prototype-store.js";

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
  apiKey: Type.Optional(Type.String())
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
  store?: PrototypeStore;
};

export function buildApp(options: BuildAppOptions) {
  const store = options.store ?? prototypeStore;
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

    if (request.cookies.fw_session !== "authenticated") {
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
    (request) => ({ authenticated: request.cookies.fw_session === "authenticated" })
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

      reply.setCookie("fw_session", "authenticated", {
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
    async (_request, reply) => {
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
    () => store.getModelConfig()
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
    (request) => store.updateModelConfig(request.body)
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
    () => store.listSaves()
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
      const save = store.getSave(request.params.id);
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
      const save = store.patchSave(request.params.id, request.body);
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
      const save = store.getSave(request.params.id);
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
      const save = store.getSave(request.params.id);
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
      return store.importSave(request.body);
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
      const save = store.rollbackSave(request.params.id);
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
      const save = store.patchSave(request.params.id, { settings: request.body });
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
      const save = store.patchCharacter(request.params.id, request.params.characterId, request.body);
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
      const save = store.patchSave(request.params.id, { worldMemory: request.body });
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
      return store.createGenerationJob(request.body);
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
      const job = store.getGenerationJob(request.params.id);
      return sendSse(reply, job ?? { error: { code: "not_found", message: "Generation job not found" } });
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
      const save = store.acceptGenerationJob(request.params.id);
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
      const job = store.createTurnJob(request.params.id, request.body);

      if (!job) {
        return sendError(reply, 404, "not_found", "Save not found");
      }

      reply.code(201);
      return job;
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
      const job = store.getTurnJob(request.params.id);
      return sendSse(reply, job ?? { error: { code: "not_found", message: "Turn job not found" } });
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
      const save = store.acceptTurn(request.params.id);
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

function sendSse(reply: SseReply, payload: unknown) {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  reply.raw.write(`event: snapshot\n`);
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  reply.raw.end();
}
