import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  Character,
  CharacterPatch,
  CreateSaveInput,
  CreateTurnInput,
  Location,
  ModelConfig,
  Relationship,
  Save,
  SaveGenerationJob,
  SaveImport,
  SaveListItem,
  StateChange,
  Turn,
  TurnEvent,
  TurnJob,
  WorldMemory
} from "@fantasy-world/shared";
import * as dbSchema from "../db/schema.js";
import { decryptSecret, encryptSecret } from "../security/secrets.js";
import { buildSave, defaultModelConfig, id, now, renderTurnEvent } from "./prototype-store.js";
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

  async createGenerationJob(input: CreateSaveInput): Promise<SaveGenerationJob> {
    const save = buildSave(input);
    const job: SaveGenerationJob = {
      id: id("generation_job"),
      status: "needs_review",
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

  async acceptGenerationJob(jobId: string): Promise<Save | undefined> {
    const job = await this.getGenerationJob(jobId);

    if (!job?.draft) {
      return undefined;
    }

    const accepted: Save = {
      ...job.draft.save,
      updatedAt: now()
    };
    const acceptedJob: SaveGenerationJob = {
      ...job,
      status: "accepted"
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

  async importSave(input: SaveImport): Promise<Save> {
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

    const character = save.characters.find((item) => item.id === characterId);

    if (!character) {
      return undefined;
    }

    const changes = { ...patch };
    delete changes.id;
    const updated: Character = {
      ...character,
      ...changes,
      id: character.id
    };

    await this.db.update(dbSchema.characters).set({ data: updated }).where(eq(dbSchema.characters.id, characterId));

    return this.readSave(saveId);
  }

  async createTurnJob(saveId: string, input: CreateTurnInput): Promise<TurnJob | undefined> {
    const save = await this.readSave(saveId);

    if (!save) {
      return undefined;
    }

    const turnNumber = save.turnNumber + 1;
    const location = save.locations[0];
    const involved = save.characters.slice(0, Math.min(2, save.characters.length));
    const instruction = input.gmInstruction?.trim();
    const eventTitle = instruction ? "GM 指令改变了局势" : "世界自行推进";
    const eventBody = renderTurnEvent(save, involved, location, instruction);
    const event = buildTurnEvent(location, involved, eventTitle, eventBody);
    const turn: Turn = {
      id: id("turn"),
      saveId,
      turnNumber,
      status: "needs_review",
      events: [event],
      stateChanges: [
        {
          id: id("change"),
          targetType: "worldMemory",
          field: "timeline",
          before: `${save.worldMemory.timeline.length} entries`,
          after: `${save.worldMemory.timeline.length + 1} entries`
        }
      ],
      callSummary: {
        model: (await this.getModelConfig()).model,
        calls: 1,
        durationMs: 320,
        estimatedTokens: 900
      },
      createdAt: now()
    };
    const updatedSave: Save = {
      ...save,
      turnNumber,
      worldMemory: {
        ...save.worldMemory,
        timeline: [...save.worldMemory.timeline, `${turnNumber}. ${eventTitle}: ${eventBody}`],
        worldSummary: `${save.worldMemory.worldSummary}\n第 ${turnNumber} 回合：${eventBody}`
      },
      updatedAt: now()
    };
    const job: TurnJob = {
      id: id("turn_job"),
      saveId,
      status: "needs_review",
      turn
    };

    await this.db.transaction(async (tx) => {
      await this.updateSaveCore(tx, updatedSave);
      await tx.insert(dbSchema.turns).values({
        id: turn.id,
        saveId,
        turnNumber,
        data: turn,
        snapshot: save,
        createdAt: new Date(turn.createdAt)
      });
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

  async acceptTurn(turnId: string): Promise<Save | undefined> {
    const turnRow = await this.db.query.turns.findFirst({
      where: eq(dbSchema.turns.id, turnId)
    });

    if (!turnRow) {
      return undefined;
    }

    const turn = turnRow.data as Turn;
    const acceptedTurn: Turn = {
      ...turn,
      status: "accepted"
    };
    const save = await this.readSave(turnRow.saveId);

    if (!save) {
      return undefined;
    }

    await this.db.transaction(async (tx) => {
      await tx.update(dbSchema.turns).set({ data: acceptedTurn }).where(eq(dbSchema.turns.id, turnId));
      await tx.update(dbSchema.saves).set({ updatedAt: new Date() }).where(eq(dbSchema.saves.id, turnRow.saveId));
      const jobs = await tx.select().from(dbSchema.turnJobs).where(eq(dbSchema.turnJobs.saveId, turnRow.saveId));

      for (const jobRow of jobs) {
        const job = jobRow.data as TurnJob;

        if (job.turn?.id === turnId) {
          const acceptedJob: TurnJob = {
            ...job,
            status: "accepted",
            turn: acceptedTurn
          };
          await tx
            .update(dbSchema.turnJobs)
            .set({ status: acceptedJob.status, data: acceptedJob, updatedAt: new Date() })
            .where(eq(dbSchema.turnJobs.id, jobRow.id));
        }
      }
    });

    return this.readSave(turnRow.saveId);
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
      schemaVersion: save.schemaVersion,
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
    await this.insertSaveEntities(db, save);
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
}

function buildTurnEvent(
  location: Location | undefined,
  involved: Character[],
  eventTitle: string,
  eventBody: string
): TurnEvent {
  return location?.id !== undefined
    ? {
        id: id("event"),
        title: eventTitle,
        body: eventBody,
        involvedCharacterIds: involved.map((character) => character.id),
        locationId: location.id
      }
    : {
        id: id("event"),
        title: eventTitle,
        body: eventBody,
        involvedCharacterIds: involved.map((character) => character.id)
      };
}

function remapImportedSave(input: SaveImport): Save {
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
      const base = {
        ...event,
        id: id("event"),
        involvedCharacterIds: event.involvedCharacterIds.map(
          (characterId) => characterIds.get(characterId) ?? characterId
        )
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

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
