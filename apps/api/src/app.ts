import { existsSync } from "node:fs";
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
  type CreateSaveInput,
  CreateCharacterInputSchema,
  CreateLocationInputSchema,
  CreatePlayerInputSchema,
  CreateRelationshipInputSchema,
  CreateSaveInputSchema,
  type CreateTurnInput,
  CreateTurnInputSchema,
  GeneratedWorldDraftSchema,
  type JobFailure,
  type LlmCallSummary,
  LocationPatchSchema,
  ModelConfigSchema,
  ModelConfigUpdateSchema,
  ModelProbeInputSchema,
  ModelProbeResultSchema,
  PatchTurnDraftInputSchema,
  PatchSaveCollaboratorInputSchema,
  type PlayerInput,
  PlayerInputSchema,
  RelationshipPatchSchema,
  ReviewPlayerInputSchema,
  SaveExportSchema,
  type SaveAccess,
  SaveCollaboratorSchema,
  SaveGenerationJobSchema,
  SaveImportSchema,
  SaveListItemSchema,
  type Save,
  SaveSchema,
  SessionSchema,
  TurnJobSchema,
  TurnOrchestrationOutputSchema,
  UpsertSaveCollaboratorInputSchema,
  type User
} from "@fantasy-world/shared";
import Fastify, { type FastifyError } from "fastify";
import { Type } from "typebox";
import { verifyPassword } from "./auth/password.js";
import type { AppEnv } from "./config/env.js";
import { createSaveExport, normalizeSaveImport } from "./import-export.js";
import { LlmService } from "./llm/service.js";
import type { LlmJsonResult, LlmJsonUsage } from "./llm/types.js";
import {
  buildTurnGenerationSystemPrompt,
  buildTurnGenerationUserPrompt,
  validateTurnGenerationOutput
} from "./llm/turn-generation.js";
import { buildWorldGenerationSystemPrompt, buildWorldGenerationUserPrompt } from "./llm/world-generation.js";
import { buildGeneratedWorldDraft, defaultUser, prototypeStore } from "./store/prototype-store.js";
import type { FantasyWorldStore } from "./store/types.js";
import { createTurnOrchestration } from "./turn/orchestrator.js";

const ParamsWithIdSchema = Type.Object({ id: Type.String() });
const GenerationParamsSchema = Type.Object({ id: Type.String() });
const TurnJobParamsSchema = Type.Object({ id: Type.String() });
const SaveParamsSchema = Type.Object({ id: Type.String() });
const CharacterParamsSchema = Type.Object({ id: Type.String(), characterId: Type.String() });
const LocationParamsSchema = Type.Object({ id: Type.String(), locationId: Type.String() });
const RelationshipParamsSchema = Type.Object({ id: Type.String(), relationshipId: Type.String() });
const CollaboratorParamsSchema = Type.Object({ id: Type.String(), userId: Type.String() });
const PlayerInputParamsSchema = Type.Object({ id: Type.String() });
const LoginBodySchema = Type.Object({
  username: Type.Optional(Type.String()),
  password: Type.String()
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
  jobExecution?: "inline" | "background";
};

export function buildApp(options: BuildAppOptions) {
  const store = options.store ?? prototypeStore;
  const llmService = options.llmService ?? new LlmService(store);
  const jobExecution = options.jobExecution ?? (options.env.nodeEnv === "production" ? "background" : "inline");
  const worker = new AppJobWorker(store, llmService);
  if (jobExecution === "background") {
    void worker.recover();
  }
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
    const code = statusCode === 500 ? "internal_error" : error.validation ? "validation_error" : "request_error";
    reply.code(statusCode).send({
      error: {
        code,
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
    if (!requiresSession(request.url)) {
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
    async (request) => {
      const user = await store.getSessionUser(request.cookies.fw_session);
      return user ? { authenticated: true, user } : { authenticated: false };
    }
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

      const user = await store.getOrCreateUser(request.body.username ?? defaultUser.username);
      const sessionId = await store.createSession(user.id);

      reply.setCookie("fw_session", sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: options.env.nodeEnv === "production",
        path: "/"
      });

      return { authenticated: true, user };
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
    async (request) => {
      const user = await getRequestUser(store, request);
      return store.listSaves(user.id);
    }
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
      const context = await getAuthorizedSave(store, request, reply, request.params.id, [
        "owner",
        "gm",
        "viewer",
        "player"
      ]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      return saveForAccess(context.save, context.access);
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
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

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
      const context = await getAuthorizedSave(store, request, reply, request.params.id, [
        "owner",
        "gm",
        "viewer",
        "player"
      ]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      return saveForAccess(context.save, context.access);
    }
  );

  app.get(
    "/api/saves/:id/export",
    {
      schema: {
        params: SaveParamsSchema,
        response: {
          200: SaveExportSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      return createSaveExport(context.save);
    }
  );

  app.get(
    "/api/saves/:id/model-config",
    {
      schema: {
        params: SaveParamsSchema,
        response: {
          200: ModelConfigSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm", "viewer"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      return (await store.getSaveModelConfig(request.params.id)) ?? (await store.getModelConfig());
    }
  );

  app.put(
    "/api/saves/:id/model-config",
    {
      schema: {
        params: SaveParamsSchema,
        body: ModelConfigUpdateSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.updateSaveModelConfig(request.params.id, request.body);
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.delete(
    "/api/saves/:id/model-config",
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
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.clearSaveModelConfig(request.params.id);
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.post(
    "/api/saves/import",
    {
      schema: {
        body: SaveImportSchema,
        response: {
          201: SaveSchema,
          400: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const imported = normalizeSaveImport(request.body);

      if (!imported.ok) {
        return sendError(reply, 400, imported.code, imported.message);
      }

      reply.code(201);
      const user = await getRequestUser(store, request);
      return await store.importSave(imported.save, user.id);
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
      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        request.params.id,
        ["owner", "gm"],
        "No rollback snapshot available"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

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
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.patchSave(request.params.id, { settings: request.body });
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.post(
    "/api/saves/:id/characters",
    {
      schema: {
        params: SaveParamsSchema,
        body: CreateCharacterInputSchema,
        response: {
          201: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        request.params.id,
        ["owner", "gm"],
        "Save or location not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.createCharacter(request.params.id, request.body);

      if (!save) {
        return sendError(reply, 404, "not_found", "Save or location not found");
      }

      reply.code(201);
      return save;
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
      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        request.params.id,
        ["owner", "gm"],
        "Character not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.patchCharacter(request.params.id, request.params.characterId, request.body);
      return save ?? sendError(reply, 404, "not_found", "Character not found");
    }
  );

  app.delete(
    "/api/saves/:id/characters/:characterId",
    {
      schema: {
        params: CharacterParamsSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        request.params.id,
        ["owner", "gm"],
        "Character not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.deleteCharacter(request.params.id, request.params.characterId);
      return save ?? sendError(reply, 404, "not_found", "Character not found");
    }
  );

  app.post(
    "/api/saves/:id/locations",
    {
      schema: {
        params: SaveParamsSchema,
        body: CreateLocationInputSchema,
        response: {
          201: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.createLocation(request.params.id, request.body);

      if (!save) {
        return sendError(reply, 404, "not_found", "Save not found");
      }

      reply.code(201);
      return save;
    }
  );

  app.patch(
    "/api/saves/:id/locations/:locationId",
    {
      schema: {
        params: LocationParamsSchema,
        body: LocationPatchSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        request.params.id,
        ["owner", "gm"],
        "Location not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.patchLocation(request.params.id, request.params.locationId, request.body);
      return save ?? sendError(reply, 404, "not_found", "Location not found");
    }
  );

  app.delete(
    "/api/saves/:id/locations/:locationId",
    {
      schema: {
        params: LocationParamsSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        request.params.id,
        ["owner", "gm"],
        "Location not found or still in use"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.deleteLocation(request.params.id, request.params.locationId);
      return save ?? sendError(reply, 404, "not_found", "Location not found or still in use");
    }
  );

  app.post(
    "/api/saves/:id/relationships",
    {
      schema: {
        params: SaveParamsSchema,
        body: CreateRelationshipInputSchema,
        response: {
          201: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        request.params.id,
        ["owner", "gm"],
        "Save or relationship character not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.createRelationship(request.params.id, request.body);

      if (!save) {
        return sendError(reply, 404, "not_found", "Save or relationship character not found");
      }

      reply.code(201);
      return save;
    }
  );

  app.patch(
    "/api/saves/:id/relationships/:relationshipId",
    {
      schema: {
        params: RelationshipParamsSchema,
        body: RelationshipPatchSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        request.params.id,
        ["owner", "gm"],
        "Relationship not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.patchRelationship(request.params.id, request.params.relationshipId, request.body);
      return save ?? sendError(reply, 404, "not_found", "Relationship not found");
    }
  );

  app.delete(
    "/api/saves/:id/relationships/:relationshipId",
    {
      schema: {
        params: RelationshipParamsSchema,
        response: {
          200: SaveSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        request.params.id,
        ["owner", "gm"],
        "Relationship not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.deleteRelationship(request.params.id, request.params.relationshipId);
      return save ?? sendError(reply, 404, "not_found", "Relationship not found");
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
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.patchSave(request.params.id, { worldMemory: request.body });
      return save ?? sendError(reply, 404, "not_found", "Save not found");
    }
  );

  app.get(
    "/api/saves/:id/collaborators",
    {
      schema: {
        params: SaveParamsSchema,
        response: {
          200: Type.Array(SaveCollaboratorSchema),
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      return store.listCollaborators(request.params.id);
    }
  );

  app.post(
    "/api/saves/:id/collaborators",
    {
      schema: {
        params: SaveParamsSchema,
        body: UpsertSaveCollaboratorInputSchema,
        response: {
          201: SaveCollaboratorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const user = await store.getOrCreateUser(request.body.username);
      const collaborator = await store.upsertCollaborator(request.params.id, user, request.body);

      if (!collaborator) {
        return sendError(reply, 404, "not_found", "Save, collaborator, or character not found");
      }

      reply.code(201);
      return collaborator;
    }
  );

  app.patch(
    "/api/saves/:id/collaborators/:userId",
    {
      schema: {
        params: CollaboratorParamsSchema,
        body: PatchSaveCollaboratorInputSchema,
        response: {
          200: SaveCollaboratorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const collaborator = await store.patchCollaborator(request.params.id, request.params.userId, request.body);
      return collaborator ?? sendError(reply, 404, "not_found", "Collaborator or character not found");
    }
  );

  app.delete(
    "/api/saves/:id/collaborators/:userId",
    {
      schema: {
        params: CollaboratorParamsSchema,
        response: {
          200: Type.Object({ removed: Type.Boolean() }),
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const removed = await store.removeCollaborator(request.params.id, request.params.userId);
      return removed ? { removed } : sendError(reply, 404, "not_found", "Collaborator not found");
    }
  );

  app.get(
    "/api/saves/:id/player-inputs",
    {
      schema: {
        params: SaveParamsSchema,
        response: {
          200: Type.Array(PlayerInputSchema),
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm", "player"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const userId = context.access.role === "player" ? context.user.id : undefined;
      return store.listPlayerInputs(request.params.id, userId);
    }
  );

  app.post(
    "/api/saves/:id/player-inputs",
    {
      schema: {
        params: SaveParamsSchema,
        body: CreatePlayerInputSchema,
        response: {
          201: PlayerInputSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["player"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const input = await store.createPlayerInput(request.params.id, context.user, request.body);

      if (!input) {
        return sendError(reply, 404, "not_found", "Player character binding not found");
      }

      reply.code(201);
      return input;
    }
  );

  app.post(
    "/api/player-inputs/:id/review",
    {
      schema: {
        params: PlayerInputParamsSchema,
        body: ReviewPlayerInputSchema,
        response: {
          200: PlayerInputSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const playerInput = await store.getPlayerInput(request.params.id);

      if (!playerInput) {
        return sendError(reply, 404, "not_found", "Player input not found");
      }

      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        playerInput.saveId,
        ["owner", "gm"],
        "Player input not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const reviewed = await store.reviewPlayerInput(request.params.id, context.user.id, request.body);
      return reviewed ?? sendError(reply, 404, "not_found", "Player input not found");
    }
  );

  app.post(
    "/api/save-generation-jobs",
    {
      schema: {
        body: CreateSaveInputSchema,
        response: {
          201: SaveGenerationJobSchema,
          502: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const user = await getRequestUser(store, request);

      if (request.body.idempotencyKey) {
        const existing = await store.getGenerationJobByIdempotencyKey(request.body.idempotencyKey, user.id);

        if (existing) {
          if (jobExecution === "background" && existing.status === "queued") {
            worker.scheduleGeneration(existing.id);
          }
          reply.code(201);
          return existing;
        }
      }

      if (jobExecution === "background") {
        const job = await store.createQueuedGenerationJob(request.body, user.id);
        worker.scheduleGeneration(job.id);
        reply.code(201);
        return job;
      }

      const generatedDraft = await generateWorldDraft(llmService, request.body);
      const llmCall = toLlmCallSummary(generatedDraft);

      if (!generatedDraft.ok) {
        reply.code(201);
        return await store.createFailedGenerationJob(
          request.body,
          toJobFailure("generating_world_draft", generatedDraft),
          llmCall,
          user.id
        );
      }

      reply.code(201);
      return await store.createGenerationJob(request.body, generatedDraft.output, llmCall, user.id);
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
      const user = await getRequestUser(store, request);
      const job = await store.getGenerationJob(request.params.id, user.id);
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
      const user = await getRequestUser(store, request);
      return sendJobSse(reply, async () => store.getGenerationJob(request.params.id, user.id), {
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
      const user = await getRequestUser(store, request);
      const existing = await store.getGenerationJob(request.params.id, user.id);

      if (!existing) {
        return sendError(reply, 404, "not_found", "Generation job not found");
      }

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
      const user = await getRequestUser(store, request);
      const current = await store.getGenerationJob(request.params.id, user.id);

      if (!current) {
        return sendError(reply, 404, "not_found", "Generation job not found");
      }

      if (
        current.status === "queued" ||
        current.status === "running" ||
        current.status === "needs_review" ||
        current.status === "accepted"
      ) {
        return current;
      }

      const input = current.input ?? current.draft?.input;

      if (!input) {
        return sendError(reply, 404, "not_found", "Generation job input not found");
      }

      if (jobExecution === "background") {
        const job = await store.queueGenerationRetry(request.params.id);

        if (job?.status === "queued") {
          worker.scheduleGeneration(job.id);
        }

        return job ?? sendError(reply, 404, "not_found", "Generation job not found");
      }

      const generatedDraft = await generateWorldDraft(llmService, input);
      const llmCall = toLlmCallSummary(generatedDraft);

      if (!generatedDraft.ok) {
        const job = await store.failGenerationJob(
          request.params.id,
          toJobFailure("generating_world_draft", generatedDraft),
          llmCall
        );
        return job ?? sendError(reply, 404, "not_found", "Generation job not found");
      }

      const job = await store.retryGenerationJob(request.params.id, generatedDraft.output, llmCall);
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
      const user = await getRequestUser(store, request);
      const save = await store.acceptGenerationJob(request.params.id, user.id);
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
          404: ApiErrorSchema,
          502: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const context = await getAuthorizedSave(store, request, reply, request.params.id, ["owner", "gm"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = context.save;
      const turnOwnerUserId = save.ownerUserId ?? defaultUser.id;

      if (request.body.idempotencyKey) {
        const existing = await store.getTurnJobByIdempotencyKey(
          request.params.id,
          request.body.idempotencyKey,
          turnOwnerUserId
        );

        if (existing) {
          if (jobExecution === "background" && existing.status === "queued") {
            worker.scheduleTurn(existing.id);
          }
          reply.code(201);
          return existing;
        }
      }

      const active = await store.getActiveTurnJob(request.params.id);

      if (active) {
        if (jobExecution === "background" && active.status === "queued") {
          worker.scheduleTurn(active.id);
        }
        reply.code(201);
        return active;
      }

      const approvedPlayerInputs = await store.listPlayerInputs(request.params.id, undefined, "approved");
      const turnInput = turnInputWithPlayerInputs(save, request.body, approvedPlayerInputs);

      if (jobExecution === "background") {
        const job = await store.createQueuedTurnJob(request.params.id, turnInput);

        if (!job) {
          return sendError(reply, 404, "not_found", "Save not found");
        }

        await store.markPlayerInputsUsed(
          request.params.id,
          approvedPlayerInputs.map((input) => input.id),
          job.id
        );
        worker.scheduleTurn(job.id);
        reply.code(201);
        return job;
      }

      const orchestration = await generateTurnDraft(llmService, save, turnInput);
      const llmCall = toLlmCallSummary(orchestration);

      if (!orchestration.ok) {
        const failurePhase =
          orchestration.error.code === "invalid_llm_reference" ? "validating_turn_references" : "generating_turn_draft";
        const job = await store.createFailedTurnJob(
          request.params.id,
          turnInput,
          toJobFailure(failurePhase, orchestration),
          llmCall
        );
        if (job) {
          await store.markPlayerInputsUsed(
            request.params.id,
            approvedPlayerInputs.map((input) => input.id),
            job.id
          );
        }
        reply.code(201);
        return job ?? sendError(reply, 404, "not_found", "Save not found");
      }

      const job = await store.createTurnJob(request.params.id, turnInput, orchestration.output, llmCall);

      if (!job) {
        return sendError(reply, 404, "not_found", "Save not found");
      }

      await store.markPlayerInputsUsed(
        request.params.id,
        approvedPlayerInputs.map((input) => input.id),
        job.id
      );
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

      if (!job) {
        return sendError(reply, 404, "not_found", "Turn job not found");
      }

      const context = await getAuthorizedSave(store, request, reply, job.saveId, ["owner", "gm", "viewer"]);

      if (!isAuthorizedSaveContext(context)) {
        return sendError(reply, 404, "not_found", "Turn job not found");
      }

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
      const initialJob = await store.getTurnJob(request.params.id);

      if (!initialJob) {
        return sendJobSse(reply, () => Promise.resolve(undefined), {
          error: { code: "not_found", message: "Turn job not found" }
        });
      }

      const context = await getAuthorizedSave(store, request, reply, initialJob.saveId, ["owner", "gm", "viewer"]);

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

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
      const existing = await store.getTurnJob(request.params.id);

      if (!existing) {
        return sendError(reply, 404, "not_found", "Editable turn draft not found");
      }

      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        existing.saveId,
        ["owner", "gm"],
        "Editable turn draft not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

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
      const existing = await store.getTurnJob(request.params.id);

      if (!existing) {
        return sendError(reply, 404, "not_found", "Turn job not found");
      }

      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        existing.saveId,
        ["owner", "gm"],
        "Turn job not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

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
      const current = await store.getTurnJob(request.params.id);

      if (!current) {
        return sendError(reply, 404, "not_found", "Turn job not found");
      }

      const context = await getAuthorizedSave(
        store,
        request,
        reply,
        current.saveId,
        ["owner", "gm"],
        "Turn job not found"
      );

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      if (
        current.status === "queued" ||
        current.status === "running" ||
        current.status === "needs_review" ||
        current.status === "accepted"
      ) {
        return current;
      }

      const save = context.save;

      if (!save) {
        return sendError(reply, 404, "not_found", "Save not found");
      }

      if (jobExecution === "background") {
        const job = await store.queueTurnRetry(request.params.id);

        if (job?.status === "queued") {
          worker.scheduleTurn(job.id);
        }

        return job ?? sendError(reply, 404, "not_found", "Turn job not found");
      }

      const orchestration = await generateTurnDraft(llmService, save, current.input ?? {});
      const llmCall = toLlmCallSummary(orchestration);

      if (!orchestration.ok) {
        const failurePhase =
          orchestration.error.code === "invalid_llm_reference" ? "validating_turn_references" : "generating_turn_draft";
        const job = await store.failTurnJob(request.params.id, toJobFailure(failurePhase, orchestration), llmCall);
        return job ?? sendError(reply, 404, "not_found", "Turn job not found");
      }

      const job = await store.retryTurnJob(request.params.id, orchestration.output, llmCall);
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
      const job = await store.getTurnJobByTurnId(request.params.id);

      if (!job) {
        return sendError(reply, 404, "not_found", "Turn not found");
      }

      const context = await getAuthorizedSave(store, request, reply, job.saveId, ["owner", "gm"], "Turn not found");

      if (!isAuthorizedSaveContext(context)) {
        return context;
      }

      const save = await store.acceptTurn(request.params.id);
      return save ?? sendError(reply, 404, "not_found", "Turn not found");
    }
  );

  if (options.env.nodeEnv === "production") {
    app.register(fastifyStatic, {
      root: resolveWebDistRoot(),
      prefix: "/"
    });
    app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));
  }

  return app;
}

type RequestWithCookies = {
  cookies: {
    fw_session?: string;
  };
};

async function getRequestUser(store: FantasyWorldStore, request: RequestWithCookies) {
  return (await store.getSessionUser(request.cookies.fw_session)) ?? defaultUser;
}

type AuthorizedSaveContext = {
  user: User;
  access: SaveAccess;
  save: Save;
};

type SaveAccessRole = SaveAccess["role"];
type ErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};

async function getAuthorizedSave(
  store: FantasyWorldStore,
  request: RequestWithCookies,
  reply: ReplyWithCode<404>,
  saveId: string,
  roles: SaveAccessRole[],
  message = "Save not found"
): Promise<AuthorizedSaveContext | ErrorPayload> {
  const user = await getRequestUser(store, request);
  const access = await store.getSaveAccess(saveId, user.id);

  if (!access || !roles.includes(access.role)) {
    return sendError(reply, 404, "not_found", message);
  }

  const save = await store.getSave(saveId);

  if (!save) {
    return sendError(reply, 404, "not_found", message);
  }

  return { user, access, save };
}

function isAuthorizedSaveContext(value: AuthorizedSaveContext | ErrorPayload): value is AuthorizedSaveContext {
  return "save" in value;
}

function saveForAccess(save: Save, access: SaveAccess) {
  return access.role === "player" ? saveForPlayer(save, access.characterId) : save;
}

function saveForPlayer(save: Save, characterId: string | undefined): Save {
  const visibleCharacter = characterId ? save.characters.find((character) => character.id === characterId) : undefined;

  if (!visibleCharacter) {
    return {
      ...save,
      characters: [],
      locations: [],
      relationships: [],
      worldMemory: {
        ...save.worldMemory,
        locationSummaries: {}
      }
    };
  }

  const locationIds = new Set([visibleCharacter.locationId]);
  const visibleRelationshipCharacters = new Set([visibleCharacter.id]);
  const relationships = save.relationships.filter(
    (relationship) =>
      relationship.sourceCharacterId === visibleCharacter.id || relationship.targetCharacterId === visibleCharacter.id
  );

  for (const relationship of relationships) {
    visibleRelationshipCharacters.add(relationship.sourceCharacterId);
    visibleRelationshipCharacters.add(relationship.targetCharacterId);
  }

  const characters = save.characters
    .filter((character) => visibleRelationshipCharacters.has(character.id))
    .map((character) =>
      character.id === visibleCharacter.id
        ? character
        : {
            ...character,
            secrets: [],
            privateMemory: []
          }
    );
  const locations = save.locations.filter((location) => locationIds.has(location.id));
  const locationSummaries = Object.fromEntries(
    Object.entries(save.worldMemory.locationSummaries).filter(([locationId]) => locationIds.has(locationId))
  );

  return {
    ...save,
    characters,
    locations,
    relationships,
    worldMemory: {
      ...save.worldMemory,
      locationSummaries
    }
  };
}

function turnInputWithPlayerInputs(save: Save, input: CreateTurnInput, playerInputs: PlayerInput[]): CreateTurnInput {
  if (playerInputs.length === 0) {
    return input;
  }

  const lines = playerInputs.map((playerInput) => {
    const character = save.characters.find((item) => item.id === playerInput.characterId);
    return `- ${character?.name ?? playerInput.username} (${playerInput.username}): ${playerInput.intent}`;
  });
  const reviewedBlock =
    save.settings.language === "zh"
      ? `已获 GM 审核的玩家输入：\n${lines.join("\n")}`
      : `GM-approved player inputs:\n${lines.join("\n")}`;

  return {
    ...input,
    gmInstruction: [input.gmInstruction, reviewedBlock].filter(Boolean).join("\n\n")
  };
}

function resolveWebDistRoot() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(dirname, "../../../web/dist"),
    path.resolve(dirname, "../../web/dist")
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? path.resolve(process.cwd(), "../web/dist");
}

export function requiresSession(url: string) {
  const pathname = url.split("?")[0] ?? url;

  if (isPublicApiPath(pathname)) {
    return false;
  }

  return pathname === "/api" || pathname.startsWith("/api/");
}

function isPublicApiPath(pathname: string) {
  return ["/api/health", "/api/auth/login", "/api/auth/session"].some(
    (publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`)
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

type FailedLlmJobResult = {
  ok: false;
  provider: "mock" | "openai-compatible";
  model: string;
  rawOutput?: string;
  usage?: LlmJsonUsage;
  estimatedCostUsd?: number;
  inputTokenPriceUsdPerMillion?: number;
  outputTokenPriceUsdPerMillion?: number;
  error: {
    code: string;
    message: string;
  };
  latencyMs: number;
};

class AppJobWorker {
  private readonly generationJobs = new Set<string>();
  private readonly turnJobs = new Set<string>();

  constructor(
    private readonly store: FantasyWorldStore,
    private readonly llmService: LlmService
  ) {}

  async recover() {
    const [generationJobs, turnJobs] = await Promise.all([
      this.store.listActiveGenerationJobs(),
      this.store.listActiveTurnJobs()
    ]);

    for (const job of generationJobs) {
      if (job.status === "queued") {
        this.scheduleGeneration(job.id);
      } else if (job.status === "running") {
        await this.store.failGenerationJob(job.id, interruptedJobFailure(job.phase ?? "running"));
      }
    }

    for (const job of turnJobs) {
      if (job.status === "queued") {
        this.scheduleTurn(job.id);
      } else if (job.status === "running") {
        await this.store.failTurnJob(job.id, interruptedJobFailure(job.phase ?? "running"));
      }
    }
  }

  scheduleGeneration(jobId: string) {
    if (this.generationJobs.has(jobId)) {
      return;
    }

    this.generationJobs.add(jobId);
    void this.runGeneration(jobId).finally(() => this.generationJobs.delete(jobId));
  }

  scheduleTurn(jobId: string) {
    if (this.turnJobs.has(jobId)) {
      return;
    }

    this.turnJobs.add(jobId);
    void this.runTurn(jobId).finally(() => this.turnJobs.delete(jobId));
  }

  private async runGeneration(jobId: string) {
    try {
      const started = await this.store.startGenerationJob(jobId, "generating_world_draft");
      const input = started?.input ?? started?.draft?.input;

      if (!started || started.status !== "running" || !input) {
        return;
      }

      const generatedDraft = await generateWorldDraft(this.llmService, input);
      const llmCall = toLlmCallSummary(generatedDraft);

      if (!generatedDraft.ok) {
        await this.store.failGenerationJob(jobId, toJobFailure("generating_world_draft", generatedDraft), llmCall);
        return;
      }

      await this.store.completeGenerationJob(jobId, generatedDraft.output, llmCall);
    } catch (error) {
      await this.store.failGenerationJob(jobId, exceptionJobFailure("generating_world_draft", error));
    }
  }

  private async runTurn(jobId: string) {
    try {
      const started = await this.store.startTurnJob(jobId, "generating_turn_draft");

      if (!started || started.status !== "running") {
        return;
      }

      const save = await this.store.getSave(started.saveId);

      if (!save) {
        await this.store.failTurnJob(jobId, {
          code: "save_not_found",
          message: "Save not found while running queued turn job",
          phase: "loading_save",
          retryable: false,
          createdAt: new Date().toISOString(),
          provider: "mock"
        });
        return;
      }

      const orchestration = await generateTurnDraft(this.llmService, save, started.input ?? {});
      const llmCall = toLlmCallSummary(orchestration);

      if (!orchestration.ok) {
        const failurePhase =
          orchestration.error.code === "invalid_llm_reference" ? "validating_turn_references" : "generating_turn_draft";
        await this.store.failTurnJob(jobId, toJobFailure(failurePhase, orchestration), llmCall);
        return;
      }

      await this.store.completeTurnJob(jobId, orchestration.output, llmCall);
    } catch (error) {
      await this.store.failTurnJob(jobId, exceptionJobFailure("generating_turn_draft", error));
    }
  }
}

function generateWorldDraft(llmService: LlmService, input: CreateSaveInput) {
  return llmService.generateJson({
    schema: GeneratedWorldDraftSchema,
    schemaName: "GeneratedWorldDraft",
    systemPrompt: buildWorldGenerationSystemPrompt(),
    userPrompt: buildWorldGenerationUserPrompt(input),
    mockOutput: buildGeneratedWorldDraft(input),
    modelOverride: input.modelOverride,
    temperature: 0.7,
    maxTokens: 4_000
  });
}

async function generateTurnDraft(llmService: LlmService, save: Save, input: CreateTurnInput) {
  const orchestration = await llmService.generateJson({
    schema: TurnOrchestrationOutputSchema,
    schemaName: "TurnOrchestrationOutput",
    systemPrompt: buildTurnGenerationSystemPrompt(),
    userPrompt: buildTurnGenerationUserPrompt(save, input),
    mockOutput: createTurnOrchestration(save, input),
    saveId: save.id,
    temperature: 0.65,
    maxTokens: 4_000
  });

  if (!orchestration.ok) {
    return orchestration;
  }

  const referenceError = validateTurnGenerationOutput(save, orchestration.output);

  if (referenceError) {
    return {
      ok: false,
      provider: orchestration.provider,
      model: orchestration.model,
      ...(orchestration.rawOutput ? { rawOutput: orchestration.rawOutput } : {}),
      ...(orchestration.usage ? { usage: orchestration.usage } : {}),
      ...(orchestration.estimatedCostUsd !== undefined ? { estimatedCostUsd: orchestration.estimatedCostUsd } : {}),
      ...(orchestration.inputTokenPriceUsdPerMillion !== undefined
        ? { inputTokenPriceUsdPerMillion: orchestration.inputTokenPriceUsdPerMillion }
        : {}),
      ...(orchestration.outputTokenPriceUsdPerMillion !== undefined
        ? { outputTokenPriceUsdPerMillion: orchestration.outputTokenPriceUsdPerMillion }
        : {}),
      latencyMs: orchestration.latencyMs,
      error: {
        code: "invalid_llm_reference",
        message: referenceError
      }
    } as const;
  }

  return orchestration;
}

function toLlmCallSummary(result: LlmJsonResult<unknown>): LlmCallSummary {
  const estimatedTokens =
    result.usage?.totalTokens ?? (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);

  return {
    provider: result.provider,
    model: result.model,
    status: result.ok ? "succeeded" : "failed",
    latencyMs: result.latencyMs,
    estimatedTokens,
    ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
    ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
    ...(result.usage?.totalTokens !== undefined ? { totalTokens: result.usage.totalTokens } : {}),
    ...(result.usage?.estimated !== undefined ? { estimatedUsage: result.usage.estimated } : {}),
    ...(result.estimatedCostUsd !== undefined ? { estimatedCostUsd: result.estimatedCostUsd } : {}),
    ...(result.inputTokenPriceUsdPerMillion !== undefined
      ? { inputTokenPriceUsdPerMillion: result.inputTokenPriceUsdPerMillion }
      : {}),
    ...(result.outputTokenPriceUsdPerMillion !== undefined
      ? { outputTokenPriceUsdPerMillion: result.outputTokenPriceUsdPerMillion }
      : {})
  };
}

function interruptedJobFailure(phase: string): JobFailure {
  return {
    code: "worker_interrupted",
    message: "The worker stopped before this job completed",
    phase,
    retryable: true,
    createdAt: new Date().toISOString(),
    provider: "mock"
  };
}

function exceptionJobFailure(phase: string, error: unknown): JobFailure {
  const message = error instanceof Error ? error.message : "The worker failed while processing this job";

  return {
    code: "worker_error",
    message,
    phase,
    retryable: true,
    createdAt: new Date().toISOString(),
    provider: "mock"
  };
}

function toJobFailure(phase: string, result: FailedLlmJobResult): JobFailure {
  const rawOutputSummary = summarizeRawOutput(result.rawOutput);

  return {
    code: result.error.code,
    message: result.error.message,
    phase,
    retryable: true,
    createdAt: new Date().toISOString(),
    provider: result.provider,
    ...(rawOutputSummary ? { rawOutputSummary } : {})
  };
}

function summarizeRawOutput(rawOutput: string | undefined) {
  const normalized = rawOutput?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > 1_000 ? `${normalized.slice(0, 1_000)}...` : normalized;
}

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
