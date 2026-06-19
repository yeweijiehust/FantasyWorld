import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  type Character,
  type CharacterPatch,
  type CreateCharacterInput,
  type CreateLocationInput,
  type CreateRelationshipInput,
  type CreateSaveInput,
  type CreateTurnInput,
  type GeneratedWorldDraft,
  type JobFailure,
  type LlmCallSummary,
  type Location,
  type LocationPatch,
  type ModelConfig,
  type ModelConfigUpdate,
  type PatchTurnDraftInput,
  type Relationship,
  type RelationshipPatch,
  type Save,
  type SaveGenerationJob,
  type SaveListItem,
  type StateChange,
  type Turn,
  type TurnOrchestrationOutput,
  type TurnJob,
  type User,
  type WorldMemory
} from "@fantasy-world/shared";
import * as dbSchema from "../db/schema.js";
import { decryptSecret, encryptSecret } from "../security/secrets.js";
import {
  applyTurnDraft,
  buildSave,
  buildTurnDraft,
  defaultModelConfig,
  defaultUser,
  id,
  isActiveJobStatus,
  mergeModelCredentials,
  now,
  patchTurnJobDraft,
  publicSaveModelConfig
} from "./prototype-store.js";
import type { FantasyWorldStore, ModelCredentials, ModelCredentialsScope } from "./types.js";

type Database = NodePgDatabase<typeof dbSchema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const modelConfigId = "global";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

export class DatabaseStore implements FantasyWorldStore {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: string
  ) {}

  async getOrCreateUser(username: string): Promise<User> {
    const normalized = normalizeUsername(username);
    const existing = await this.db.query.users.findFirst({
      where: eq(dbSchema.users.username, normalized)
    });

    if (existing) {
      return rowToUser(existing);
    }

    const user: User = {
      id: normalized === defaultUser.username ? defaultUser.id : id("user"),
      username: normalized,
      role: normalized === defaultUser.username ? "admin" : "player"
    };

    await this.db.insert(dbSchema.users).values({
      ...user,
      createdAt: new Date()
    });

    return structuredClone(user);
  }

  async createSession(userId = defaultUser.id): Promise<string> {
    const sessionId = id("session");
    const createdAt = new Date();

    await this.db.insert(dbSchema.sessions).values({
      id: sessionId,
      userId,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + sessionTtlMs)
    });

    return sessionId;
  }

  async hasSession(sessionId: string | undefined): Promise<boolean> {
    if (!sessionId) {
      return false;
    }

    const row = await this.db.query.sessions.findFirst({
      where: and(eq(dbSchema.sessions.id, sessionId), gt(dbSchema.sessions.expiresAt, new Date()))
    });

    return Boolean(row);
  }

  async getSessionUser(sessionId: string | undefined): Promise<User | undefined> {
    if (!sessionId) {
      return undefined;
    }

    const row = await this.db.query.sessions.findFirst({
      where: and(eq(dbSchema.sessions.id, sessionId), gt(dbSchema.sessions.expiresAt, new Date()))
    });

    if (!row) {
      return undefined;
    }

    const userId = row.userId ?? defaultUser.id;
    const user = await this.db.query.users.findFirst({
      where: eq(dbSchema.users.id, userId)
    });

    return user ? rowToUser(user) : structuredClone(defaultUser);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.delete(dbSchema.sessions).where(eq(dbSchema.sessions.id, sessionId));
  }

  async getModelConfig(): Promise<ModelConfig> {
    const row = await this.db.query.modelConfigs.findFirst({
      where: eq(dbSchema.modelConfigs.id, modelConfigId)
    });

    if (!row) {
      return structuredClone(defaultModelConfig);
    }

    const data = row.data as ModelConfig;

    return structuredClone({
      ...data,
      hasApiKey: Boolean(row.apiKeyCiphertext) || data.hasApiKey
    });
  }

  async getModelCredentials(scope: ModelCredentialsScope = {}): Promise<ModelCredentials> {
    const row = await this.db.query.modelConfigs.findFirst({
      where: eq(dbSchema.modelConfigs.id, modelConfigId)
    });
    const config = row ? await this.getModelConfig() : structuredClone(defaultModelConfig);
    const credentials: ModelCredentials = { ...config };

    if (row?.apiKeyCiphertext) {
      credentials.apiKey = decryptSecret(row.apiKeyCiphertext, this.encryptionKey);
    }

    const save = scope.saveId
      ? await this.db.query.saves.findFirst({
          where: eq(dbSchema.saves.id, scope.saveId)
        })
      : undefined;
    const saveConfig = save?.modelConfig
      ? normalizeSaveModelConfig(save.modelConfig as ModelConfig, Boolean(save.modelApiKeyCiphertext))
      : undefined;
    const saveApiKey = save?.modelApiKeyCiphertext
      ? decryptSecret(save.modelApiKeyCiphertext, this.encryptionKey)
      : undefined;

    return structuredClone(mergeModelCredentials(credentials, saveConfig, saveApiKey, scope.modelOverride));
  }

  async updateModelConfig(input: ModelConfigUpdate): Promise<ModelConfig> {
    const existing = await this.db.query.modelConfigs.findFirst({
      where: eq(dbSchema.modelConfigs.id, modelConfigId)
    });
    const current = await this.getModelConfig();
    const { apiKey, ...modelInput } = input;
    const cleanApiKey = apiKey?.trim();
    const next: ModelConfig = {
      ...current,
      ...modelInput,
      hasApiKey: Boolean(cleanApiKey) || Boolean(existing?.apiKeyCiphertext) || current.hasApiKey,
      supportsJsonMode: modelInput.supportsJsonMode ?? current.supportsJsonMode ?? true,
      supportsUsage: modelInput.supportsUsage ?? current.supportsUsage ?? true,
      supportsStream: modelInput.supportsStream ?? current.supportsStream ?? false
    };
    const apiKeyCiphertext = cleanApiKey ? encryptSecret(cleanApiKey, this.encryptionKey) : existing?.apiKeyCiphertext;

    if (cleanApiKey) {
      next.apiKeyTail = cleanApiKey.slice(-4);
    } else if (current.apiKeyTail) {
      next.apiKeyTail = current.apiKeyTail;
    }

    if (existing) {
      await this.db
        .update(dbSchema.modelConfigs)
        .set({ data: next, apiKeyCiphertext: apiKeyCiphertext ?? null, updatedAt: new Date() })
        .where(eq(dbSchema.modelConfigs.id, modelConfigId));
    } else {
      await this.db.insert(dbSchema.modelConfigs).values({
        id: modelConfigId,
        data: next,
        apiKeyCiphertext: apiKeyCiphertext ?? null,
        updatedAt: new Date()
      });
    }

    return this.getModelConfig();
  }

  async getSaveModelConfig(saveId: string): Promise<ModelConfig | undefined> {
    const row = await this.db.query.saves.findFirst({
      where: eq(dbSchema.saves.id, saveId)
    });

    if (!row?.modelConfig) {
      return undefined;
    }

    return structuredClone(
      normalizeSaveModelConfig(row.modelConfig as ModelConfig, Boolean(row.modelApiKeyCiphertext))
    );
  }

  async updateSaveModelConfig(saveId: string, input: ModelConfigUpdate): Promise<Save | undefined> {
    const current = await this.readSave(saveId);

    if (!current) {
      return undefined;
    }

    const row = await this.db.query.saves.findFirst({
      where: eq(dbSchema.saves.id, saveId)
    });
    const { apiKey, ...modelInput } = input;
    const cleanApiKey = apiKey?.trim();
    const base = current.modelConfig ?? publicSaveModelConfig(await this.getModelConfig());
    const apiKeyCiphertext = cleanApiKey ? encryptSecret(cleanApiKey, this.encryptionKey) : row?.modelApiKeyCiphertext;
    const nextModelConfig: ModelConfig = normalizeSaveModelConfig(
      {
        ...base,
        ...modelInput,
        hasApiKey: Boolean(cleanApiKey) || Boolean(apiKeyCiphertext),
        supportsJsonMode: modelInput.supportsJsonMode ?? base.supportsJsonMode ?? true,
        supportsUsage: modelInput.supportsUsage ?? base.supportsUsage ?? true,
        supportsStream: modelInput.supportsStream ?? base.supportsStream ?? false
      },
      Boolean(apiKeyCiphertext)
    );

    if (cleanApiKey) {
      nextModelConfig.apiKeyTail = cleanApiKey.slice(-4);
    }

    const updated: Save = {
      ...current,
      modelConfig: nextModelConfig,
      updatedAt: now()
    };

    await this.db
      .update(dbSchema.saves)
      .set({
        modelConfig: nextModelConfig,
        modelApiKeyCiphertext: apiKeyCiphertext ?? null,
        updatedAt: new Date(updated.updatedAt)
      })
      .where(eq(dbSchema.saves.id, saveId));

    return this.readSave(saveId);
  }

  async clearSaveModelConfig(saveId: string): Promise<Save | undefined> {
    const current = await this.readSave(saveId);

    if (!current) {
      return undefined;
    }

    await this.db
      .update(dbSchema.saves)
      .set({
        modelConfig: null,
        modelApiKeyCiphertext: null,
        updatedAt: new Date()
      })
      .where(eq(dbSchema.saves.id, saveId));

    return this.readSave(saveId);
  }

  async listSaves(ownerUserId = defaultUser.id): Promise<SaveListItem[]> {
    const [saveRows, characterRows] = await Promise.all([
      this.db.select().from(dbSchema.saves).orderBy(desc(dbSchema.saves.updatedAt)),
      this.db.select({ saveId: dbSchema.characters.saveId }).from(dbSchema.characters)
    ]);
    const characterCounts = new Map<string, number>();

    for (const row of characterRows) {
      characterCounts.set(row.saveId, (characterCounts.get(row.saveId) ?? 0) + 1);
    }

    return saveRows
      .filter((save) => ownerMatches(save.ownerUserId, ownerUserId))
      .map((save) => ({
        id: save.id,
        ...(save.ownerUserId ? { ownerUserId: save.ownerUserId } : {}),
        name: save.name,
        description: save.description,
        language: (save.settings as Save["settings"]).language,
        turnNumber: save.turnNumber,
        characterCount: characterCounts.get(save.id) ?? 0,
        updatedAt: toIso(save.updatedAt)
      }));
  }

  async getSave(saveId: string, ownerUserId?: string): Promise<Save | undefined> {
    const save = await this.readSave(saveId);
    return save && (!ownerUserId || ownerMatches(save.ownerUserId, ownerUserId)) ? save : undefined;
  }

  async createQueuedGenerationJob(input: CreateSaveInput, ownerUserId = defaultUser.id): Promise<SaveGenerationJob> {
    if (input.idempotencyKey) {
      const existing = await this.getGenerationJobByIdempotencyKey(input.idempotencyKey, ownerUserId);

      if (existing) {
        return existing;
      }
    }

    const job: SaveGenerationJob = {
      id: id("generation_job"),
      ownerUserId,
      status: "queued",
      phase: "queued",
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      input
    };

    await this.db.insert(dbSchema.saveGenerationJobs).values({
      id: job.id,
      status: job.status,
      data: job,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return structuredClone(job);
  }

  async createGenerationJob(
    input: CreateSaveInput,
    generatedDraft?: GeneratedWorldDraft,
    llmCall?: LlmCallSummary,
    ownerUserId = defaultUser.id
  ): Promise<SaveGenerationJob> {
    if (input.idempotencyKey) {
      const existing = await this.getGenerationJobByIdempotencyKey(input.idempotencyKey, ownerUserId);

      if (existing) {
        return existing;
      }
    }

    const save = { ...buildSave(input, generatedDraft), ownerUserId };
    const job: SaveGenerationJob = {
      id: id("generation_job"),
      ownerUserId,
      status: "needs_review",
      phase: "ready_for_review",
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      input,
      ...(llmCall ? { llmCall } : {}),
      draft: {
        id: id("draft"),
        input,
        save,
        createdAt: now()
      }
    };

    await this.db.insert(dbSchema.saveGenerationJobs).values({
      id: job.id,
      status: job.status,
      data: job,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return structuredClone(job);
  }

  async createFailedGenerationJob(
    input: CreateSaveInput,
    failure: JobFailure,
    llmCall?: LlmCallSummary,
    ownerUserId = defaultUser.id
  ): Promise<SaveGenerationJob> {
    if (input.idempotencyKey) {
      const existing = await this.getGenerationJobByIdempotencyKey(input.idempotencyKey, ownerUserId);

      if (existing) {
        return existing;
      }
    }

    const job: SaveGenerationJob = {
      id: id("generation_job"),
      ownerUserId,
      status: "failed",
      phase: failure.phase,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      input,
      ...(llmCall ? { llmCall } : {}),
      error: failure.message,
      failure
    };

    await this.db.insert(dbSchema.saveGenerationJobs).values({
      id: job.id,
      status: job.status,
      data: job,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return structuredClone(job);
  }

  async getGenerationJob(jobId: string, ownerUserId?: string): Promise<SaveGenerationJob | undefined> {
    const row = await this.db.query.saveGenerationJobs.findFirst({
      where: eq(dbSchema.saveGenerationJobs.id, jobId)
    });

    const job = row ? (row.data as SaveGenerationJob) : undefined;
    return job && (!ownerUserId || ownerMatches(job.ownerUserId, ownerUserId)) ? structuredClone(job) : undefined;
  }

  async listActiveGenerationJobs(): Promise<SaveGenerationJob[]> {
    const rows = await this.db.select().from(dbSchema.saveGenerationJobs);

    return rows
      .map((row) => row.data as SaveGenerationJob)
      .filter((job) => isActiveJobStatus(job.status))
      .map((job) => structuredClone(job));
  }

  async startGenerationJob(jobId: string, phase: string): Promise<SaveGenerationJob | undefined> {
    const job = await this.getGenerationJob(jobId);

    if (!job || job.status !== "queued") {
      return job;
    }

    const running: SaveGenerationJob = {
      ...job,
      status: "running",
      phase
    };

    await this.db
      .update(dbSchema.saveGenerationJobs)
      .set({ status: running.status, data: running, updatedAt: new Date() })
      .where(eq(dbSchema.saveGenerationJobs.id, jobId));

    return structuredClone(running);
  }

  async completeGenerationJob(
    jobId: string,
    generatedDraft: GeneratedWorldDraft,
    llmCall?: LlmCallSummary
  ): Promise<SaveGenerationJob | undefined> {
    const job = await this.getGenerationJob(jobId);
    const input = job?.input ?? job?.draft?.input;

    if (!job || !input || job.status === "cancelled" || job.status === "accepted") {
      return undefined;
    }

    const completed: SaveGenerationJob = {
      id: job.id,
      ...(job.ownerUserId ? { ownerUserId: job.ownerUserId } : {}),
      status: "needs_review",
      phase: "ready_for_review",
      ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
      input,
      ...(llmCall ? { llmCall } : {}),
      draft: {
        id: id("draft"),
        input,
        save: { ...buildSave(input, generatedDraft), ownerUserId: job.ownerUserId ?? defaultUser.id },
        createdAt: now()
      }
    };

    await this.db
      .update(dbSchema.saveGenerationJobs)
      .set({ status: completed.status, data: completed, updatedAt: new Date() })
      .where(eq(dbSchema.saveGenerationJobs.id, jobId));

    return structuredClone(completed);
  }

  async failGenerationJob(
    jobId: string,
    failure: JobFailure,
    llmCall?: LlmCallSummary
  ): Promise<SaveGenerationJob | undefined> {
    const job = await this.getGenerationJob(jobId);

    if (!job) {
      return undefined;
    }

    const failed: SaveGenerationJob = {
      ...job,
      status: "failed",
      phase: failure.phase,
      ...(llmCall ? { llmCall } : {}),
      error: failure.message,
      failure
    };

    await this.db
      .update(dbSchema.saveGenerationJobs)
      .set({ status: failed.status, data: failed, updatedAt: new Date() })
      .where(eq(dbSchema.saveGenerationJobs.id, jobId));

    return structuredClone(failed);
  }

  async cancelGenerationJob(jobId: string): Promise<SaveGenerationJob | undefined> {
    const job = await this.getGenerationJob(jobId);

    if (!job) {
      return undefined;
    }

    if (job.status === "cancelled" || job.status === "accepted") {
      return job;
    }

    const cancelled: SaveGenerationJob = {
      ...job,
      status: "cancelled",
      phase: "cancelled"
    };

    await this.db
      .update(dbSchema.saveGenerationJobs)
      .set({ status: cancelled.status, data: cancelled, updatedAt: new Date() })
      .where(eq(dbSchema.saveGenerationJobs.id, jobId));

    return structuredClone(cancelled);
  }

  async retryGenerationJob(
    jobId: string,
    generatedDraft?: GeneratedWorldDraft,
    llmCall?: LlmCallSummary
  ): Promise<SaveGenerationJob | undefined> {
    const job = await this.getGenerationJob(jobId);
    const input = job?.input ?? job?.draft?.input;

    if (!job || !input) {
      return undefined;
    }

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return job;
    }

    const retried: SaveGenerationJob = {
      id: job.id,
      ...(job.ownerUserId ? { ownerUserId: job.ownerUserId } : {}),
      status: "needs_review",
      phase: "ready_for_review",
      ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
      input,
      ...(llmCall ? { llmCall } : {}),
      draft: {
        id: id("draft"),
        input,
        save: { ...buildSave(input, generatedDraft), ownerUserId: job.ownerUserId ?? defaultUser.id },
        createdAt: now()
      }
    };

    await this.db
      .update(dbSchema.saveGenerationJobs)
      .set({ status: retried.status, data: retried, updatedAt: new Date() })
      .where(eq(dbSchema.saveGenerationJobs.id, jobId));

    return structuredClone(retried);
  }

  async queueGenerationRetry(jobId: string): Promise<SaveGenerationJob | undefined> {
    const job = await this.getGenerationJob(jobId);
    const input = job?.input ?? job?.draft?.input;

    if (!job || !input) {
      return undefined;
    }

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return job;
    }

    const queued: SaveGenerationJob = {
      id: job.id,
      ...(job.ownerUserId ? { ownerUserId: job.ownerUserId } : {}),
      status: "queued",
      phase: "queued",
      ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
      input
    };

    await this.db
      .update(dbSchema.saveGenerationJobs)
      .set({ status: queued.status, data: queued, updatedAt: new Date() })
      .where(eq(dbSchema.saveGenerationJobs.id, jobId));

    return structuredClone(queued);
  }

  async acceptGenerationJob(jobId: string, ownerUserId?: string): Promise<Save | undefined> {
    const job = await this.getGenerationJob(jobId);

    if (
      !job?.draft ||
      job.status === "cancelled" ||
      job.status === "failed" ||
      (ownerUserId && !ownerMatches(job.ownerUserId, ownerUserId))
    ) {
      return undefined;
    }

    const accepted: Save = {
      ...job.draft.save,
      updatedAt: now()
    };
    const acceptedJob: SaveGenerationJob = {
      ...job,
      status: "accepted",
      phase: "accepted"
    };

    await this.db.transaction(async (tx) => {
      await this.insertSave(tx, accepted);
      await tx
        .update(dbSchema.saveGenerationJobs)
        .set({ status: acceptedJob.status, data: acceptedJob, updatedAt: new Date() })
        .where(eq(dbSchema.saveGenerationJobs.id, jobId));
    });

    return this.readSave(accepted.id);
  }

  async importSave(input: Save, ownerUserId = defaultUser.id): Promise<Save> {
    const save = remapImportedSave(input);
    save.ownerUserId = ownerUserId;

    await this.insertSave(this.db, save);

    const stored = await this.readSave(save.id);

    if (!stored) {
      throw new Error("Imported save was not stored");
    }

    return stored;
  }

  async patchSave(
    saveId: string,
    patch: Partial<Pick<Save, "name" | "description" | "settings" | "worldMemory">>
  ): Promise<Save | undefined> {
    const current = await this.readSave(saveId);

    if (!current) {
      return undefined;
    }

    const next: Save = {
      ...current,
      ...patch,
      updatedAt: now()
    };

    await this.updateSaveCore(this.db, next);

    return this.readSave(saveId);
  }

  async patchCharacter(saveId: string, characterId: string, patch: CharacterPatch): Promise<Save | undefined> {
    const save = await this.readSave(saveId);

    if (!save) {
      return undefined;
    }

    if (save.schemaVersion !== CURRENT_SAVE_SCHEMA_VERSION) {
      return undefined;
    }

    const character = save.characters.find((item) => item.id === characterId);

    if (!character) {
      return undefined;
    }

    const changes = { ...patch };
    delete changes.id;

    if (changes.locationId && !save.locations.some((location) => location.id === changes.locationId)) {
      return undefined;
    }

    const updated: Character = {
      ...character,
      ...changes,
      id: character.id
    };

    await this.db.update(dbSchema.characters).set({ data: updated }).where(eq(dbSchema.characters.id, characterId));

    return this.readSave(saveId);
  }

  async createCharacter(saveId: string, input: CreateCharacterInput): Promise<Save | undefined> {
    const save = await this.readSave(saveId);

    if (!save || !save.locations.some((location) => location.id === input.locationId)) {
      return undefined;
    }

    const updated: Save = {
      ...save,
      characters: [...save.characters, { ...input, id: id("character") }],
      updatedAt: now()
    };

    await this.db.transaction(async (tx) => this.replaceSaveState(tx, updated));
    return this.readSave(saveId);
  }

  async deleteCharacter(saveId: string, characterId: string): Promise<Save | undefined> {
    const save = await this.readSave(saveId);

    if (!save || !save.characters.some((character) => character.id === characterId)) {
      return undefined;
    }

    const updated: Save = {
      ...save,
      characters: save.characters.filter((character) => character.id !== characterId),
      relationships: save.relationships.filter(
        (relationship) =>
          relationship.sourceCharacterId !== characterId && relationship.targetCharacterId !== characterId
      ),
      updatedAt: now()
    };

    await this.db.transaction(async (tx) => this.replaceSaveState(tx, updated));
    return this.readSave(saveId);
  }

  async createLocation(saveId: string, input: CreateLocationInput): Promise<Save | undefined> {
    const save = await this.readSave(saveId);

    if (!save) {
      return undefined;
    }

    const location: Location = { ...input, id: id("location") };
    const updated: Save = {
      ...save,
      locations: [...save.locations, location],
      worldMemory: {
        ...save.worldMemory,
        locationSummaries: {
          ...save.worldMemory.locationSummaries,
          [location.id]: location.description
        }
      },
      updatedAt: now()
    };

    await this.db.transaction(async (tx) => this.replaceSaveState(tx, updated));
    return this.readSave(saveId);
  }

  async patchLocation(saveId: string, locationId: string, patch: LocationPatch): Promise<Save | undefined> {
    const save = await this.readSave(saveId);

    if (!save || !save.locations.some((location) => location.id === locationId)) {
      return undefined;
    }

    const changes = { ...patch };
    delete changes.id;
    const updated: Save = {
      ...save,
      locations: save.locations.map((location) =>
        location.id === locationId ? { ...location, ...changes, id: location.id } : location
      ),
      worldMemory:
        changes.description === undefined
          ? save.worldMemory
          : {
              ...save.worldMemory,
              locationSummaries: {
                ...save.worldMemory.locationSummaries,
                [locationId]: changes.description
              }
            },
      updatedAt: now()
    };

    await this.db.transaction(async (tx) => this.replaceSaveState(tx, updated));
    return this.readSave(saveId);
  }

  async deleteLocation(saveId: string, locationId: string): Promise<Save | undefined> {
    const save = await this.readSave(saveId);

    if (
      !save ||
      !save.locations.some((location) => location.id === locationId) ||
      save.characters.some((character) => character.locationId === locationId)
    ) {
      return undefined;
    }

    const locationSummaries = { ...save.worldMemory.locationSummaries };
    delete locationSummaries[locationId];
    const updated: Save = {
      ...save,
      locations: save.locations.filter((location) => location.id !== locationId),
      worldMemory: {
        ...save.worldMemory,
        locationSummaries
      },
      updatedAt: now()
    };

    await this.db.transaction(async (tx) => this.replaceSaveState(tx, updated));
    return this.readSave(saveId);
  }

  async createRelationship(saveId: string, input: CreateRelationshipInput): Promise<Save | undefined> {
    const save = await this.readSave(saveId);

    if (!save || !relationshipCharactersExist(save, input.sourceCharacterId, input.targetCharacterId)) {
      return undefined;
    }

    const updated: Save = {
      ...save,
      relationships: [...save.relationships, { ...input, id: id("relationship") }],
      updatedAt: now()
    };

    await this.db.transaction(async (tx) => this.replaceSaveState(tx, updated));
    return this.readSave(saveId);
  }

  async patchRelationship(saveId: string, relationshipId: string, patch: RelationshipPatch): Promise<Save | undefined> {
    const save = await this.readSave(saveId);
    const relationship = save?.relationships.find((item) => item.id === relationshipId);

    if (!save || !relationship) {
      return undefined;
    }

    const changes = { ...patch };
    delete changes.id;
    const sourceCharacterId = changes.sourceCharacterId ?? relationship.sourceCharacterId;
    const targetCharacterId = changes.targetCharacterId ?? relationship.targetCharacterId;

    if (!relationshipCharactersExist(save, sourceCharacterId, targetCharacterId)) {
      return undefined;
    }

    const updated: Save = {
      ...save,
      relationships: save.relationships.map((item) =>
        item.id === relationshipId ? { ...item, ...changes, id: item.id } : item
      ),
      updatedAt: now()
    };

    await this.db.transaction(async (tx) => this.replaceSaveState(tx, updated));
    return this.readSave(saveId);
  }

  async deleteRelationship(saveId: string, relationshipId: string): Promise<Save | undefined> {
    const save = await this.readSave(saveId);

    if (!save || !save.relationships.some((relationship) => relationship.id === relationshipId)) {
      return undefined;
    }

    const updated: Save = {
      ...save,
      relationships: save.relationships.filter((relationship) => relationship.id !== relationshipId),
      updatedAt: now()
    };

    await this.db.transaction(async (tx) => this.replaceSaveState(tx, updated));
    return this.readSave(saveId);
  }

  async createTurnJob(
    saveId: string,
    input: CreateTurnInput,
    orchestration?: TurnOrchestrationOutput,
    llmCall?: LlmCallSummary
  ): Promise<TurnJob | undefined> {
    const save = await this.readSave(saveId);

    if (!save) {
      return undefined;
    }

    if (input.idempotencyKey) {
      const existing = await this.getTurnJobByIdempotencyKey(
        saveId,
        input.idempotencyKey,
        save.ownerUserId ?? defaultUser.id
      );

      if (existing) {
        return existing;
      }
    }

    const active = await this.getActiveTurnJob(saveId);

    if (active) {
      return active;
    }

    const { job } = buildTurnDraft(
      save,
      input,
      (await this.getModelCredentials({ saveId })).model,
      undefined,
      undefined,
      orchestration,
      llmCall
    );

    await this.db.transaction(async (tx) => {
      await tx.insert(dbSchema.turnJobs).values({
        id: job.id,
        saveId,
        status: job.status,
        data: job,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    return structuredClone(job);
  }

  async createQueuedTurnJob(saveId: string, input: CreateTurnInput): Promise<TurnJob | undefined> {
    const save = await this.readSave(saveId);

    if (!save) {
      return undefined;
    }

    if (input.idempotencyKey) {
      const existing = await this.getTurnJobByIdempotencyKey(
        saveId,
        input.idempotencyKey,
        save.ownerUserId ?? defaultUser.id
      );

      if (existing) {
        return existing;
      }
    }

    const active = await this.getActiveTurnJob(saveId);

    if (active) {
      return active;
    }

    const job: TurnJob = {
      id: id("turn_job"),
      saveId,
      ...(save.ownerUserId ? { ownerUserId: save.ownerUserId } : {}),
      status: "queued",
      phase: "queued",
      input,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
    };

    await this.db.insert(dbSchema.turnJobs).values({
      id: job.id,
      saveId,
      status: job.status,
      data: job,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return structuredClone(job);
  }

  async createFailedTurnJob(
    saveId: string,
    input: CreateTurnInput,
    failure: JobFailure,
    llmCall?: LlmCallSummary
  ): Promise<TurnJob | undefined> {
    const save = await this.readSave(saveId);

    if (!save) {
      return undefined;
    }

    if (input.idempotencyKey) {
      const existing = await this.getTurnJobByIdempotencyKey(
        saveId,
        input.idempotencyKey,
        save.ownerUserId ?? defaultUser.id
      );

      if (existing) {
        return existing;
      }
    }

    const active = await this.getActiveTurnJob(saveId);

    if (active) {
      return active;
    }

    const job: TurnJob = {
      id: id("turn_job"),
      saveId,
      ...(save.ownerUserId ? { ownerUserId: save.ownerUserId } : {}),
      status: "failed",
      phase: failure.phase,
      input,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(llmCall ? { llmCall } : {}),
      error: failure.message,
      failure
    };

    await this.db.insert(dbSchema.turnJobs).values({
      id: job.id,
      saveId,
      status: job.status,
      data: job,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return structuredClone(job);
  }

  async listActiveTurnJobs(): Promise<TurnJob[]> {
    const rows = await this.db.select().from(dbSchema.turnJobs);

    return rows
      .map((row) => row.data as TurnJob)
      .filter((job) => isActiveJobStatus(job.status))
      .map((job) => structuredClone(job));
  }

  async startTurnJob(jobId: string, phase: string): Promise<TurnJob | undefined> {
    const job = await this.getTurnJob(jobId);

    if (!job || job.status !== "queued") {
      return job;
    }

    const running: TurnJob = {
      ...job,
      status: "running",
      phase
    };

    await this.db
      .update(dbSchema.turnJobs)
      .set({ status: running.status, data: running, updatedAt: new Date() })
      .where(eq(dbSchema.turnJobs.id, jobId));

    return structuredClone(running);
  }

  async completeTurnJob(
    jobId: string,
    orchestration: TurnOrchestrationOutput,
    llmCall?: LlmCallSummary
  ): Promise<TurnJob | undefined> {
    const job = await this.getTurnJob(jobId);

    if (!job || job.status === "cancelled" || job.status === "accepted") {
      return undefined;
    }

    const save = await this.readSave(job.saveId);

    if (!save) {
      return undefined;
    }

    const { job: completed } = buildTurnDraft(
      save,
      job.input ?? {},
      (await this.getModelCredentials({ saveId: job.saveId })).model,
      job.id,
      job.idempotencyKey,
      orchestration,
      llmCall
    );

    await this.db
      .update(dbSchema.turnJobs)
      .set({ status: completed.status, data: completed, updatedAt: new Date() })
      .where(eq(dbSchema.turnJobs.id, jobId));

    return structuredClone(completed);
  }

  async failTurnJob(jobId: string, failure: JobFailure, llmCall?: LlmCallSummary): Promise<TurnJob | undefined> {
    const row = await this.db.query.turnJobs.findFirst({
      where: eq(dbSchema.turnJobs.id, jobId)
    });

    if (!row) {
      return undefined;
    }

    const job = row.data as TurnJob;
    const failed: TurnJob = {
      ...job,
      status: "failed",
      phase: failure.phase,
      ...(llmCall ? { llmCall } : {}),
      error: failure.message,
      failure
    };

    if (job.turn) {
      failed.turn = { ...job.turn, status: "failed" };
    }

    await this.db
      .update(dbSchema.turnJobs)
      .set({ status: failed.status, data: failed, updatedAt: new Date() })
      .where(eq(dbSchema.turnJobs.id, jobId));

    return structuredClone(failed);
  }

  async patchTurnDraft(jobId: string, input: PatchTurnDraftInput): Promise<TurnJob | undefined> {
    const row = await this.db.query.turnJobs.findFirst({
      where: eq(dbSchema.turnJobs.id, jobId)
    });

    if (!row) {
      return undefined;
    }

    const patched = patchTurnJobDraft(row.data as TurnJob, input);

    if (!patched) {
      return undefined;
    }

    await this.db
      .update(dbSchema.turnJobs)
      .set({ status: patched.status, data: patched, updatedAt: new Date() })
      .where(eq(dbSchema.turnJobs.id, jobId));

    return structuredClone(patched);
  }

  async cancelTurnJob(jobId: string): Promise<TurnJob | undefined> {
    const row = await this.db.query.turnJobs.findFirst({
      where: eq(dbSchema.turnJobs.id, jobId)
    });

    if (!row) {
      return undefined;
    }

    const job = row.data as TurnJob;

    if (job.status === "cancelled" || job.status === "accepted") {
      return structuredClone(job);
    }

    const cancelled: TurnJob = {
      ...job,
      status: "cancelled",
      phase: "cancelled"
    };

    if (job.turn) {
      cancelled.turn = { ...job.turn, status: "cancelled" };
    }

    const turnRow = job.turn
      ? await this.db.query.turns.findFirst({
          where: eq(dbSchema.turns.id, job.turn.id)
        })
      : undefined;

    await this.db.transaction(async (tx) => {
      if (turnRow) {
        await this.replaceSaveState(tx, { ...(turnRow.snapshot as Save), updatedAt: now() });
        await tx.delete(dbSchema.turns).where(eq(dbSchema.turns.id, turnRow.id));
      }

      await tx
        .update(dbSchema.turnJobs)
        .set({ status: cancelled.status, data: cancelled, updatedAt: new Date() })
        .where(eq(dbSchema.turnJobs.id, jobId));
    });

    return structuredClone(cancelled);
  }

  async retryTurnJob(
    jobId: string,
    orchestration?: TurnOrchestrationOutput,
    llmCall?: LlmCallSummary
  ): Promise<TurnJob | undefined> {
    const row = await this.db.query.turnJobs.findFirst({
      where: eq(dbSchema.turnJobs.id, jobId)
    });

    if (!row) {
      return undefined;
    }

    const job = row.data as TurnJob;

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return structuredClone(job);
    }

    const save = await this.readSave(job.saveId);

    if (!save) {
      return undefined;
    }

    const { job: retried } = buildTurnDraft(
      save,
      job.input ?? {},
      (await this.getModelCredentials({ saveId: job.saveId })).model,
      job.id,
      job.idempotencyKey,
      orchestration,
      llmCall
    );

    await this.db.transaction(async (tx) => {
      if (job.turn) {
        await tx.delete(dbSchema.turns).where(eq(dbSchema.turns.id, job.turn.id));
      }

      await tx
        .update(dbSchema.turnJobs)
        .set({ status: retried.status, data: retried, updatedAt: new Date() })
        .where(eq(dbSchema.turnJobs.id, jobId));
    });

    return structuredClone(retried);
  }

  async queueTurnRetry(jobId: string): Promise<TurnJob | undefined> {
    const job = await this.getTurnJob(jobId);

    if (!job) {
      return undefined;
    }

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return job;
    }

    const queued: TurnJob = {
      id: job.id,
      saveId: job.saveId,
      ...(job.ownerUserId ? { ownerUserId: job.ownerUserId } : {}),
      status: "queued",
      phase: "queued",
      input: job.input ?? {},
      ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {})
    };

    await this.db.transaction(async (tx) => {
      if (job.turn) {
        await tx.delete(dbSchema.turns).where(eq(dbSchema.turns.id, job.turn.id));
      }

      await tx
        .update(dbSchema.turnJobs)
        .set({ status: queued.status, data: queued, updatedAt: new Date() })
        .where(eq(dbSchema.turnJobs.id, jobId));
    });

    return structuredClone(queued);
  }

  async acceptTurn(turnId: string, ownerUserId?: string): Promise<Save | undefined> {
    const jobRows = await this.db.select().from(dbSchema.turnJobs);
    const jobRow = jobRows.find((row) => (row.data as TurnJob).turn?.id === turnId);

    if (!jobRow) {
      return undefined;
    }

    const job = jobRow.data as TurnJob;

    if (ownerUserId && !ownerMatches(job.ownerUserId, ownerUserId)) {
      return undefined;
    }

    if (job.status === "accepted") {
      return this.readSave(job.saveId);
    }

    const save = await this.readSave(job.saveId);

    if (!save) {
      return undefined;
    }

    const updatedSave = applyTurnDraft(save, job);
    const acceptedTurn = updatedSave?.turns.find((turn) => turn.id === turnId);

    if (!updatedSave || !acceptedTurn || !job.turn) {
      return undefined;
    }

    const acceptedJob: TurnJob = {
      ...job,
      status: "accepted",
      phase: "accepted",
      turn: acceptedTurn
    };

    await this.db.transaction(async (tx) => {
      await this.replaceSaveState(tx, updatedSave);
      await tx.insert(dbSchema.turns).values({
        id: acceptedTurn.id,
        saveId: job.saveId,
        turnNumber: acceptedTurn.turnNumber,
        data: acceptedTurn,
        snapshot: save,
        createdAt: new Date(acceptedTurn.createdAt)
      });
      await tx
        .update(dbSchema.turnJobs)
        .set({ status: acceptedJob.status, data: acceptedJob, updatedAt: new Date() })
        .where(eq(dbSchema.turnJobs.id, jobRow.id));
    });

    return this.readSave(job.saveId);
  }

  async rollbackSave(saveId: string): Promise<Save | undefined> {
    const current = await this.readSave(saveId);
    const latestTurn = current?.headTurnId
      ? await this.db.query.turns.findFirst({
          where: and(eq(dbSchema.turns.id, current.headTurnId), eq(dbSchema.turns.saveId, saveId))
        })
      : await this.db.query.turns.findFirst({
          where: eq(dbSchema.turns.saveId, saveId),
          orderBy: desc(dbSchema.turns.turnNumber)
        });

    if (!latestTurn) {
      return undefined;
    }

    const snapshot = latestTurn.snapshot as Save;
    const restored: Save = {
      ...snapshot,
      updatedAt: now()
    };

    await this.db.transaction(async (tx) => {
      await this.replaceSaveState(tx, restored);
    });

    return this.readSave(saveId);
  }

  async getTurnJob(jobId: string, ownerUserId?: string): Promise<TurnJob | undefined> {
    const row = await this.db.query.turnJobs.findFirst({
      where: eq(dbSchema.turnJobs.id, jobId)
    });

    const job = row ? (row.data as TurnJob) : undefined;
    return job && (!ownerUserId || ownerMatches(job.ownerUserId, ownerUserId)) ? structuredClone(job) : undefined;
  }

  async getGenerationJobByIdempotencyKey(
    idempotencyKey: string,
    ownerUserId?: string
  ): Promise<SaveGenerationJob | undefined> {
    const rows = await this.db.select().from(dbSchema.saveGenerationJobs);
    const row = rows.find((item) => {
      const job = item.data as SaveGenerationJob;
      return job.idempotencyKey === idempotencyKey && (!ownerUserId || ownerMatches(job.ownerUserId, ownerUserId));
    });

    return row ? structuredClone(row.data as SaveGenerationJob) : undefined;
  }

  async getTurnJobByIdempotencyKey(
    saveId: string,
    idempotencyKey: string,
    ownerUserId?: string
  ): Promise<TurnJob | undefined> {
    const rows = await this.db.select().from(dbSchema.turnJobs).where(eq(dbSchema.turnJobs.saveId, saveId));
    const row = rows.find((item) => {
      const job = item.data as TurnJob;
      return job.idempotencyKey === idempotencyKey && (!ownerUserId || ownerMatches(job.ownerUserId, ownerUserId));
    });

    return row ? structuredClone(row.data as TurnJob) : undefined;
  }

  async getActiveTurnJob(saveId: string): Promise<TurnJob | undefined> {
    const rows = await this.db.select().from(dbSchema.turnJobs).where(eq(dbSchema.turnJobs.saveId, saveId));
    const row = rows.find((item) => isActiveJobStatus((item.data as TurnJob).status));

    return row ? structuredClone(row.data as TurnJob) : undefined;
  }

  private async readSave(saveId: string): Promise<Save | undefined> {
    const save = await this.db.query.saves.findFirst({
      where: eq(dbSchema.saves.id, saveId)
    });

    if (!save) {
      return undefined;
    }

    const [characters, locations, relationships, turns] = await Promise.all([
      this.db.select().from(dbSchema.characters).where(eq(dbSchema.characters.saveId, saveId)),
      this.db.select().from(dbSchema.locations).where(eq(dbSchema.locations.saveId, saveId)),
      this.db.select().from(dbSchema.relationships).where(eq(dbSchema.relationships.saveId, saveId)),
      this.db
        .select()
        .from(dbSchema.turns)
        .where(eq(dbSchema.turns.saveId, saveId))
        .orderBy(asc(dbSchema.turns.turnNumber), asc(dbSchema.turns.createdAt))
    ]);

    return {
      id: save.id,
      ...(save.ownerUserId ? { ownerUserId: save.ownerUserId } : {}),
      name: save.name,
      description: save.description,
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      turnNumber: save.turnNumber,
      ...(save.headTurnId ? { headTurnId: save.headTurnId } : {}),
      ...(save.currentBranchId ? { currentBranchId: save.currentBranchId } : {}),
      saveSeed: save.saveSeed,
      settings: structuredClone(save.settings as Save["settings"]),
      ...(save.modelConfig
        ? {
            modelConfig: normalizeSaveModelConfig(save.modelConfig as ModelConfig, Boolean(save.modelApiKeyCiphertext))
          }
        : {}),
      worldMemory: structuredClone(save.worldMemory as WorldMemory),
      characters: characters.map((row) => structuredClone(row.data as Character)),
      locations: locations.map((row) => structuredClone(row.data as Location)),
      relationships: relationships.map((row) => structuredClone(row.data as Relationship)),
      turns: turns.map((row) => structuredClone(row.data as Turn)),
      createdAt: toIso(save.createdAt),
      updatedAt: toIso(save.updatedAt)
    };
  }

  private async insertSave(db: Database | Transaction, save: Save) {
    await db.insert(dbSchema.saves).values({
      id: save.id,
      ownerUserId: save.ownerUserId ?? null,
      name: save.name,
      description: save.description,
      schemaVersion: save.schemaVersion,
      turnNumber: save.turnNumber,
      headTurnId: save.headTurnId ?? null,
      currentBranchId: save.currentBranchId ?? null,
      saveSeed: save.saveSeed,
      settings: save.settings,
      modelConfig: save.modelConfig ? normalizeSaveModelConfig(save.modelConfig, false) : null,
      modelApiKeyCiphertext: null,
      worldMemory: save.worldMemory,
      createdAt: new Date(save.createdAt),
      updatedAt: new Date(save.updatedAt)
    });
    await this.insertSaveEntities(db, save);
  }

  private async replaceSaveState(db: Transaction, save: Save) {
    await this.updateSaveCore(db, save);
    await db.delete(dbSchema.characters).where(eq(dbSchema.characters.saveId, save.id));
    await db.delete(dbSchema.locations).where(eq(dbSchema.locations.saveId, save.id));
    await db.delete(dbSchema.relationships).where(eq(dbSchema.relationships.saveId, save.id));
    await this.insertWorldEntities(db, save);
  }

  private async updateSaveCore(db: Database | Transaction, save: Save) {
    await db
      .update(dbSchema.saves)
      .set({
        name: save.name,
        ownerUserId: save.ownerUserId ?? null,
        description: save.description,
        schemaVersion: save.schemaVersion,
        turnNumber: save.turnNumber,
        headTurnId: save.headTurnId ?? null,
        currentBranchId: save.currentBranchId ?? null,
        saveSeed: save.saveSeed,
        settings: save.settings,
        modelConfig: save.modelConfig ?? null,
        worldMemory: save.worldMemory,
        updatedAt: new Date(save.updatedAt)
      })
      .where(eq(dbSchema.saves.id, save.id));
  }

  private async insertSaveEntities(db: Database | Transaction, save: Save) {
    await this.insertWorldEntities(db, save);

    if (save.turns.length > 0) {
      await db.insert(dbSchema.turns).values(
        save.turns.map((turn) => ({
          id: turn.id,
          saveId: save.id,
          turnNumber: turn.turnNumber,
          data: turn,
          snapshot: buildSnapshotBeforeTurn(save, turn),
          createdAt: new Date(turn.createdAt)
        }))
      );
    }
  }

  private async insertWorldEntities(db: Database | Transaction, save: Save) {
    if (save.characters.length > 0) {
      await db.insert(dbSchema.characters).values(
        save.characters.map((character) => ({
          id: character.id,
          saveId: save.id,
          data: character
        }))
      );
    }

    if (save.locations.length > 0) {
      await db.insert(dbSchema.locations).values(
        save.locations.map((location) => ({
          id: location.id,
          saveId: save.id,
          data: location
        }))
      );
    }

    if (save.relationships.length > 0) {
      await db.insert(dbSchema.relationships).values(
        save.relationships.map((relationship) => ({
          id: relationship.id,
          saveId: save.id,
          data: relationship
        }))
      );
    }
  }
}

function remapImportedSave(input: Save): Save {
  const saveId = id("save");
  const locationIds = new Map(input.locations.map((location) => [location.id, id("location")]));
  const characterIds = new Map(input.characters.map((character) => [character.id, id("character")]));
  const relationshipIds = new Map(input.relationships.map((relationship) => [relationship.id, id("relationship")]));
  const turnIds = new Map(input.turns.map((turn) => [turn.id, id("turn")]));
  const remapTargetId = (targetType: StateChange["targetType"], targetId: string | undefined) => {
    if (!targetId) {
      return undefined;
    }

    if (targetType === "character") {
      return characterIds.get(targetId) ?? targetId;
    }

    if (targetType === "location") {
      return locationIds.get(targetId) ?? targetId;
    }

    if (targetType === "relationship") {
      return relationshipIds.get(targetId) ?? targetId;
    }

    return targetId;
  };
  const locations = input.locations.map<Location>((location) => ({
    ...location,
    id: locationIds.get(location.id) ?? id("location")
  }));
  const characters = input.characters.map<Character>((character) => ({
    ...character,
    id: characterIds.get(character.id) ?? id("character"),
    locationId: locationIds.get(character.locationId) ?? character.locationId
  }));
  const relationships = input.relationships.map<Relationship>((relationship) => ({
    ...relationship,
    id: relationshipIds.get(relationship.id) ?? id("relationship"),
    sourceCharacterId: characterIds.get(relationship.sourceCharacterId) ?? relationship.sourceCharacterId,
    targetCharacterId: characterIds.get(relationship.targetCharacterId) ?? relationship.targetCharacterId
  }));
  const turns = input.turns.map<Turn>((turn) => ({
    ...turn,
    id: turnIds.get(turn.id) ?? id("turn"),
    saveId,
    ...(turn.parentTurnId ? { parentTurnId: turnIds.get(turn.parentTurnId) ?? turn.parentTurnId } : {}),
    events: turn.events.map((event) => {
      const locationId = event.locationId ? (locationIds.get(event.locationId) ?? event.locationId) : undefined;
      const dialogue = event.dialogue?.map((line) => ({
        ...line,
        characterId: characterIds.get(line.characterId) ?? line.characterId
      }));
      const base = {
        ...event,
        id: id("event"),
        involvedCharacterIds: event.involvedCharacterIds.map(
          (characterId) => characterIds.get(characterId) ?? characterId
        ),
        ...(dialogue ? { dialogue } : {})
      };

      return locationId ? { ...base, locationId } : base;
    }),
    stateChanges: turn.stateChanges.map((change) => {
      const targetId = remapTargetId(change.targetType, change.targetId);

      return targetId
        ? {
            ...change,
            id: id("change"),
            targetId
          }
        : {
            ...change,
            id: id("change")
          };
    })
  }));
  const locationSummaries = Object.fromEntries(
    Object.entries(input.worldMemory.locationSummaries).map(([locationId, summary]) => [
      locationIds.get(locationId) ?? locationId,
      summary
    ])
  );

  return {
    ...input,
    id: saveId,
    ...(input.headTurnId ? { headTurnId: turnIds.get(input.headTurnId) ?? input.headTurnId } : {}),
    worldMemory: {
      ...input.worldMemory,
      locationSummaries
    },
    characters,
    locations,
    relationships,
    turns,
    createdAt: now(),
    updatedAt: now()
  };
}

function normalizeSaveModelConfig(input: ModelConfig, hasApiKey: boolean): ModelConfig {
  const next: ModelConfig = {
    ...input,
    hasApiKey
  };

  if (!hasApiKey) {
    delete next.apiKeyTail;
  }

  return next;
}

function buildSnapshotBeforeTurn(save: Save, turn: Turn): Save {
  const previousTurnNumber = Math.max(0, turn.turnNumber - 1);
  const snapshot: Save = {
    ...save,
    turnNumber: previousTurnNumber,
    worldMemory: {
      ...save.worldMemory,
      timeline: save.worldMemory.timeline.slice(0, previousTurnNumber)
    },
    turns: save.turns.filter((item) => item.turnNumber < turn.turnNumber)
  };

  delete snapshot.headTurnId;
  delete snapshot.currentBranchId;

  if (turn.parentTurnId) {
    snapshot.headTurnId = turn.parentTurnId;
  }

  if (turn.branchId) {
    snapshot.currentBranchId = turn.branchId;
  }

  return snapshot;
}

function relationshipCharactersExist(save: Save, sourceCharacterId: string, targetCharacterId: string) {
  return (
    sourceCharacterId !== targetCharacterId &&
    save.characters.some((character) => character.id === sourceCharacterId) &&
    save.characters.some((character) => character.id === targetCharacterId)
  );
}

function normalizeUsername(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized || defaultUser.username;
}

function ownerMatches(ownerUserId: string | null | undefined, requestedUserId: string) {
  return (ownerUserId ?? defaultUser.id) === requestedUserId;
}

function rowToUser(row: { id: string; username: string; role: string }): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role === "admin" ? "admin" : "player"
  };
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
