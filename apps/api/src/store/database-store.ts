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
  type Location,
  type LocationPatch,
  type ModelConfig,
  type PatchTurnDraftInput,
  type Relationship,
  type RelationshipPatch,
  type Save,
  type SaveGenerationJob,
  type SaveListItem,
  type StateChange,
  type Turn,
  type TurnJob,
  type WorldMemory
} from "@fantasy-world/shared";
import * as dbSchema from "../db/schema.js";
import { decryptSecret, encryptSecret } from "../security/secrets.js";
import {
  applyTurnDraft,
  buildSave,
  buildTurnDraft,
  defaultModelConfig,
  id,
  isActiveJobStatus,
  now,
  patchTurnJobDraft
} from "./prototype-store.js";
import type { FantasyWorldStore, ModelCredentials } from "./types.js";

type Database = NodePgDatabase<typeof dbSchema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const modelConfigId = "global";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

export class DatabaseStore implements FantasyWorldStore {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: string
  ) {}

  async createSession(): Promise<string> {
    const sessionId = id("session");
    const createdAt = new Date();

    await this.db.insert(dbSchema.sessions).values({
      id: sessionId,
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

  async getModelCredentials(): Promise<ModelCredentials> {
    const row = await this.db.query.modelConfigs.findFirst({
      where: eq(dbSchema.modelConfigs.id, modelConfigId)
    });

    if (!row) {
      return structuredClone(defaultModelConfig);
    }

    const config = await this.getModelConfig();
    const credentials: ModelCredentials = {
      ...config
    };

    if (row.apiKeyCiphertext) {
      credentials.apiKey = decryptSecret(row.apiKeyCiphertext, this.encryptionKey);
    }

    return structuredClone(credentials);
  }

  async updateModelConfig(input: Partial<ModelConfig> & { apiKey?: string }): Promise<ModelConfig> {
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

  async listSaves(): Promise<SaveListItem[]> {
    const [saveRows, characterRows] = await Promise.all([
      this.db.select().from(dbSchema.saves).orderBy(desc(dbSchema.saves.updatedAt)),
      this.db.select({ saveId: dbSchema.characters.saveId }).from(dbSchema.characters)
    ]);
    const characterCounts = new Map<string, number>();

    for (const row of characterRows) {
      characterCounts.set(row.saveId, (characterCounts.get(row.saveId) ?? 0) + 1);
    }

    return saveRows.map((save) => ({
      id: save.id,
      name: save.name,
      description: save.description,
      language: (save.settings as Save["settings"]).language,
      turnNumber: save.turnNumber,
      characterCount: characterCounts.get(save.id) ?? 0,
      updatedAt: toIso(save.updatedAt)
    }));
  }

  async getSave(saveId: string): Promise<Save | undefined> {
    return this.readSave(saveId);
  }

  async createGenerationJob(input: CreateSaveInput, generatedDraft?: GeneratedWorldDraft): Promise<SaveGenerationJob> {
    if (input.idempotencyKey) {
      const existing = await this.getGenerationJobByIdempotencyKey(input.idempotencyKey);

      if (existing) {
        return existing;
      }
    }

    const save = buildSave(input, generatedDraft);
    const job: SaveGenerationJob = {
      id: id("generation_job"),
      status: "needs_review",
      phase: "ready_for_review",
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
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

  async getGenerationJob(jobId: string): Promise<SaveGenerationJob | undefined> {
    const row = await this.db.query.saveGenerationJobs.findFirst({
      where: eq(dbSchema.saveGenerationJobs.id, jobId)
    });

    return row ? structuredClone(row.data as SaveGenerationJob) : undefined;
  }

  async cancelGenerationJob(jobId: string): Promise<SaveGenerationJob | undefined> {
    const job = await this.getGenerationJob(jobId);

    if (!job) {
      return undefined;
    }

    if (!isActiveJobStatus(job.status)) {
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

  async retryGenerationJob(jobId: string): Promise<SaveGenerationJob | undefined> {
    const job = await this.getGenerationJob(jobId);

    if (!job?.draft) {
      return undefined;
    }

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return job;
    }

    const retried: SaveGenerationJob = {
      id: job.id,
      status: "needs_review",
      phase: "ready_for_review",
      ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
      draft: {
        ...job.draft,
        id: id("draft"),
        save: buildSave(job.draft.input),
        createdAt: now()
      }
    };

    await this.db
      .update(dbSchema.saveGenerationJobs)
      .set({ status: retried.status, data: retried, updatedAt: new Date() })
      .where(eq(dbSchema.saveGenerationJobs.id, jobId));

    return structuredClone(retried);
  }

  async acceptGenerationJob(jobId: string): Promise<Save | undefined> {
    const job = await this.getGenerationJob(jobId);

    if (!job?.draft || job.status === "cancelled" || job.status === "failed") {
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

  async importSave(input: Save): Promise<Save> {
    const save = remapImportedSave(input);

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

  async createTurnJob(saveId: string, input: CreateTurnInput): Promise<TurnJob | undefined> {
    const save = await this.readSave(saveId);

    if (!save) {
      return undefined;
    }

    if (input.idempotencyKey) {
      const existing = await this.findTurnJobByIdempotencyKey(saveId, input.idempotencyKey);

      if (existing) {
        return existing;
      }
    }

    const active = await this.findActiveTurnJob(saveId);

    if (active) {
      return active;
    }

    const { job } = buildTurnDraft(save, input, (await this.getModelConfig()).model);

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

    if (!isActiveJobStatus(job.status)) {
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

  async retryTurnJob(jobId: string): Promise<TurnJob | undefined> {
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
      (await this.getModelConfig()).model,
      job.id,
      job.idempotencyKey
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

  async acceptTurn(turnId: string): Promise<Save | undefined> {
    const jobRows = await this.db.select().from(dbSchema.turnJobs);
    const jobRow = jobRows.find((row) => (row.data as TurnJob).turn?.id === turnId);

    if (!jobRow) {
      return undefined;
    }

    const job = jobRow.data as TurnJob;

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
    const latestTurn = await this.db.query.turns.findFirst({
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
      await tx
        .delete(dbSchema.turns)
        .where(and(eq(dbSchema.turns.saveId, saveId), gt(dbSchema.turns.turnNumber, snapshot.turnNumber)));
      await this.replaceSaveState(tx, restored);
    });

    return this.readSave(saveId);
  }

  async getTurnJob(jobId: string): Promise<TurnJob | undefined> {
    const row = await this.db.query.turnJobs.findFirst({
      where: eq(dbSchema.turnJobs.id, jobId)
    });

    return row ? structuredClone(row.data as TurnJob) : undefined;
  }

  async getGenerationJobByIdempotencyKey(idempotencyKey: string): Promise<SaveGenerationJob | undefined> {
    const rows = await this.db.select().from(dbSchema.saveGenerationJobs);
    const row = rows.find((item) => (item.data as SaveGenerationJob).idempotencyKey === idempotencyKey);

    return row ? structuredClone(row.data as SaveGenerationJob) : undefined;
  }

  private async findTurnJobByIdempotencyKey(saveId: string, idempotencyKey: string): Promise<TurnJob | undefined> {
    const rows = await this.db.select().from(dbSchema.turnJobs).where(eq(dbSchema.turnJobs.saveId, saveId));
    const row = rows.find((item) => (item.data as TurnJob).idempotencyKey === idempotencyKey);

    return row ? structuredClone(row.data as TurnJob) : undefined;
  }

  private async findActiveTurnJob(saveId: string): Promise<TurnJob | undefined> {
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
        .orderBy(asc(dbSchema.turns.turnNumber))
    ]);

    return {
      id: save.id,
      name: save.name,
      description: save.description,
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      turnNumber: save.turnNumber,
      saveSeed: save.saveSeed,
      settings: structuredClone(save.settings as Save["settings"]),
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
      name: save.name,
      description: save.description,
      schemaVersion: save.schemaVersion,
      turnNumber: save.turnNumber,
      saveSeed: save.saveSeed,
      settings: save.settings,
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
        description: save.description,
        schemaVersion: save.schemaVersion,
        turnNumber: save.turnNumber,
        saveSeed: save.saveSeed,
        settings: save.settings,
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

function buildSnapshotBeforeTurn(save: Save, turn: Turn): Save {
  const previousTurnNumber = Math.max(0, turn.turnNumber - 1);

  return {
    ...save,
    turnNumber: previousTurnNumber,
    worldMemory: {
      ...save.worldMemory,
      timeline: save.worldMemory.timeline.slice(0, previousTurnNumber)
    },
    turns: save.turns.filter((item) => item.turnNumber < turn.turnNumber)
  };
}

function relationshipCharactersExist(save: Save, sourceCharacterId: string, targetCharacterId: string) {
  return (
    sourceCharacterId !== targetCharacterId &&
    save.characters.some((character) => character.id === sourceCharacterId) &&
    save.characters.some((character) => character.id === targetCharacterId)
  );
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
