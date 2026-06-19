import type {
  Character,
  CreateSaveInput,
  CreateTurnInput,
  CreateCharacterInput,
  CreateLocationInput,
  CreateRelationshipInput,
  JobStatus,
  GeneratedWorldDraft,
  JobFailure,
  Location,
  LlmCallSummary,
  LocationPatch,
  ModelConfig,
  ModelConfigUpdate,
  CharacterPatch,
  Relationship,
  RelationshipPatch,
  PatchTurnDraftInput,
  Save,
  SaveGenerationJob,
  SaveListItem,
  Turn,
  TurnOrchestrationOutput,
  TurnDraftState,
  TurnJob,
  User
} from "@fantasy-world/shared";
import { CURRENT_SAVE_SCHEMA_VERSION, getWorldTemplate } from "@fantasy-world/shared";
import { clampRelationshipStrength, createTurnOrchestration } from "../turn/orchestrator.js";
import type { FantasyWorldStore, ModelCredentials, ModelCredentialsScope } from "./types.js";

export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export const defaultModelConfig: ModelConfig = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  hasApiKey: false,
  supportsJsonMode: true,
  supportsUsage: true,
  supportsStream: false
};
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
export const defaultUser: User = {
  id: "user_admin",
  username: "admin",
  role: "admin"
};

export function publicSaveModelConfig(input: ModelConfig): ModelConfig {
  const next: ModelConfig = {
    ...input,
    hasApiKey: false
  };

  delete next.apiKeyTail;
  return next;
}

export function mergeModelCredentials(
  globalCredentials: ModelCredentials,
  saveConfig?: ModelConfig,
  saveApiKey?: string,
  modelOverride?: ModelCredentialsScope["modelOverride"]
): ModelCredentials {
  const merged: ModelCredentials = {
    ...globalCredentials,
    ...(saveConfig ?? {}),
    ...(modelOverride ?? {})
  };

  if (saveApiKey) {
    merged.apiKey = saveApiKey;
    merged.hasApiKey = true;
    merged.apiKeyTail = saveApiKey.slice(-4);
  } else if (globalCredentials.apiKey) {
    merged.apiKey = globalCredentials.apiKey;
    merged.hasApiKey = true;
    if (globalCredentials.apiKeyTail) {
      merged.apiKeyTail = globalCredentials.apiKeyTail;
    } else {
      delete merged.apiKeyTail;
    }
  } else {
    delete merged.apiKey;
    merged.hasApiKey = false;
    delete merged.apiKeyTail;
  }

  return merged;
}

export class PrototypeStore implements FantasyWorldStore {
  private readonly users = new Map<string, User>([[defaultUser.id, defaultUser]]);
  private readonly saves = new Map<string, Save>();
  private readonly generationJobs = new Map<string, SaveGenerationJob>();
  private readonly turnJobs = new Map<string, TurnJob>();
  private readonly rollbackSnapshots = new Map<string, Save[]>();
  private readonly sessions = new Map<string, { expiresAt: number; userId: string }>();
  private readonly saveModelApiKeys = new Map<string, string>();
  private modelConfig: ModelConfig = defaultModelConfig;
  private modelApiKey: string | undefined;

  getSession() {
    return { authenticated: true };
  }

  getOrCreateUser(username: string) {
    const normalized = normalizeUsername(username);
    const existing = [...this.users.values()].find((user) => user.username === normalized);

    if (existing) {
      return structuredClone(existing);
    }

    const user: User = {
      id: id("user"),
      username: normalized,
      role: normalized === defaultUser.username ? "admin" : "player"
    };
    this.users.set(user.id, user);
    return structuredClone(user);
  }

  createSession(userId = defaultUser.id) {
    const sessionId = id("session");
    this.sessions.set(sessionId, { expiresAt: Date.now() + sessionTtlMs, userId });
    return sessionId;
  }

  hasSession(sessionId: string | undefined) {
    if (!sessionId) {
      return false;
    }

    const session = this.sessions.get(sessionId);
    const expiresAt = session?.expiresAt;

    if (!expiresAt || expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }

    return true;
  }

  getSessionUser(sessionId: string | undefined) {
    if (!sessionId || !this.hasSession(sessionId)) {
      return undefined;
    }

    const userId = this.sessions.get(sessionId)?.userId ?? defaultUser.id;
    const user = this.users.get(userId) ?? defaultUser;
    return structuredClone(user);
  }

  deleteSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  getModelConfig() {
    return structuredClone(this.modelConfig);
  }

  getModelCredentials(scope: Parameters<FantasyWorldStore["getModelCredentials"]>[0] = {}) {
    const credentials: ModelCredentials = {
      ...this.modelConfig
    };

    if (this.modelApiKey) {
      credentials.apiKey = this.modelApiKey;
    }

    const saveConfig = scope.saveId ? this.saves.get(scope.saveId)?.modelConfig : undefined;
    const saveApiKey = scope.saveId ? this.saveModelApiKeys.get(scope.saveId) : undefined;

    return structuredClone(mergeModelCredentials(credentials, saveConfig, saveApiKey, scope.modelOverride));
  }

  updateModelConfig(input: ModelConfigUpdate) {
    const { apiKey, ...modelInput } = input;
    const cleanApiKey = apiKey?.trim();
    const next: ModelConfig = {
      ...this.modelConfig,
      ...modelInput,
      hasApiKey: Boolean(cleanApiKey) || Boolean(this.modelApiKey) || this.modelConfig.hasApiKey,
      supportsJsonMode: modelInput.supportsJsonMode ?? this.modelConfig.supportsJsonMode ?? true,
      supportsUsage: modelInput.supportsUsage ?? this.modelConfig.supportsUsage ?? true,
      supportsStream: modelInput.supportsStream ?? this.modelConfig.supportsStream ?? false
    };

    if (cleanApiKey) {
      this.modelApiKey = cleanApiKey;
      next.apiKeyTail = cleanApiKey.slice(-4);
    } else if (this.modelConfig.apiKeyTail) {
      next.apiKeyTail = this.modelConfig.apiKeyTail;
    }

    this.modelConfig = next;

    return this.getModelConfig();
  }

  getSaveModelConfig(saveId: string): ModelConfig | undefined {
    return structuredClone(this.saves.get(saveId)?.modelConfig);
  }

  updateSaveModelConfig(saveId: string, input: ModelConfigUpdate): Save | undefined {
    const save = this.saves.get(saveId);

    if (!save) {
      return undefined;
    }

    const { apiKey, ...modelInput } = input;
    const cleanApiKey = apiKey?.trim();
    const current = save.modelConfig ?? publicSaveModelConfig(this.modelConfig);
    const next: ModelConfig = {
      ...current,
      ...modelInput,
      hasApiKey: Boolean(cleanApiKey) || this.saveModelApiKeys.has(saveId),
      supportsJsonMode: modelInput.supportsJsonMode ?? current.supportsJsonMode ?? true,
      supportsUsage: modelInput.supportsUsage ?? current.supportsUsage ?? true,
      supportsStream: modelInput.supportsStream ?? current.supportsStream ?? false
    };

    if (cleanApiKey) {
      this.saveModelApiKeys.set(saveId, cleanApiKey);
      next.apiKeyTail = cleanApiKey.slice(-4);
      next.hasApiKey = true;
    } else if (!next.hasApiKey) {
      delete next.apiKeyTail;
    }

    const updated = {
      ...save,
      modelConfig: next,
      updatedAt: now()
    };

    this.saves.set(saveId, structuredClone(updated));
    return structuredClone(updated);
  }

  clearSaveModelConfig(saveId: string): Save | undefined {
    const save = this.saves.get(saveId);

    if (!save) {
      return undefined;
    }

    this.saveModelApiKeys.delete(saveId);
    const updated: Save = {
      ...save,
      updatedAt: now()
    };
    delete updated.modelConfig;

    this.saves.set(saveId, structuredClone(updated));
    return structuredClone(updated);
  }

  listSaves(ownerUserId = defaultUser.id): SaveListItem[] {
    return [...this.saves.values()]
      .filter((save) => ownerMatches(save.ownerUserId, ownerUserId))
      .map((save) => ({
        id: save.id,
        ...(save.ownerUserId ? { ownerUserId: save.ownerUserId } : {}),
        name: save.name,
        description: save.description,
        language: save.settings.language,
        turnNumber: save.turnNumber,
        characterCount: save.characters.length,
        updatedAt: save.updatedAt
      }));
  }

  getSave(saveId: string, ownerUserId?: string): Save | undefined {
    const save = this.saves.get(saveId);
    if (!save || (ownerUserId && !ownerMatches(save.ownerUserId, ownerUserId))) {
      return undefined;
    }
    return save ? structuredClone(save) : undefined;
  }

  createQueuedGenerationJob(input: CreateSaveInput, ownerUserId = defaultUser.id): SaveGenerationJob {
    if (input.idempotencyKey) {
      const existing = this.getGenerationJobByIdempotencyKey(input.idempotencyKey, ownerUserId);

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

    this.generationJobs.set(job.id, job);
    return structuredClone(job);
  }

  createGenerationJob(
    input: CreateSaveInput,
    generatedDraft?: GeneratedWorldDraft,
    llmCall?: LlmCallSummary,
    ownerUserId = defaultUser.id
  ): SaveGenerationJob {
    if (input.idempotencyKey) {
      const existing = this.getGenerationJobByIdempotencyKey(input.idempotencyKey, ownerUserId);

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

    this.generationJobs.set(job.id, job);
    return structuredClone(job);
  }

  createFailedGenerationJob(
    input: CreateSaveInput,
    failure: JobFailure,
    llmCall?: LlmCallSummary,
    ownerUserId = defaultUser.id
  ): SaveGenerationJob {
    if (input.idempotencyKey) {
      const existing = this.getGenerationJobByIdempotencyKey(input.idempotencyKey, ownerUserId);

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

    this.generationJobs.set(job.id, job);
    return structuredClone(job);
  }

  getGenerationJobByIdempotencyKey(idempotencyKey: string, ownerUserId?: string): SaveGenerationJob | undefined {
    const job = [...this.generationJobs.values()].find(
      (item) => item.idempotencyKey === idempotencyKey && (!ownerUserId || ownerMatches(item.ownerUserId, ownerUserId))
    );
    return job ? structuredClone(job) : undefined;
  }

  getGenerationJob(jobId: string, ownerUserId?: string): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);
    if (!job || (ownerUserId && !ownerMatches(job.ownerUserId, ownerUserId))) {
      return undefined;
    }
    return job ? structuredClone(job) : undefined;
  }

  listActiveGenerationJobs(): SaveGenerationJob[] {
    return [...this.generationJobs.values()]
      .filter((job) => isActiveJobStatus(job.status))
      .map((job) => structuredClone(job));
  }

  startGenerationJob(jobId: string, phase: string): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);

    if (!job || job.status !== "queued") {
      return job ? structuredClone(job) : undefined;
    }

    const running: SaveGenerationJob = {
      ...job,
      status: "running",
      phase
    };

    this.generationJobs.set(jobId, running);
    return structuredClone(running);
  }

  completeGenerationJob(
    jobId: string,
    generatedDraft: GeneratedWorldDraft,
    llmCall?: LlmCallSummary
  ): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);
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

    this.generationJobs.set(jobId, completed);
    return structuredClone(completed);
  }

  failGenerationJob(jobId: string, failure: JobFailure, llmCall?: LlmCallSummary): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);

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

    this.generationJobs.set(jobId, failed);
    return structuredClone(failed);
  }

  cancelGenerationJob(jobId: string): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);

    if (!job) {
      return undefined;
    }

    if (job.status === "cancelled" || job.status === "accepted") {
      return structuredClone(job);
    }

    const cancelled: SaveGenerationJob = {
      ...job,
      status: "cancelled",
      phase: "cancelled"
    };

    this.generationJobs.set(jobId, cancelled);
    return structuredClone(cancelled);
  }

  retryGenerationJob(
    jobId: string,
    generatedDraft?: GeneratedWorldDraft,
    llmCall?: LlmCallSummary
  ): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);
    const input = job?.input ?? job?.draft?.input;

    if (!job || !input) {
      return undefined;
    }

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return structuredClone(job);
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

    this.generationJobs.set(jobId, retried);
    return structuredClone(retried);
  }

  queueGenerationRetry(jobId: string): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);
    const input = job?.input ?? job?.draft?.input;

    if (!job || !input) {
      return undefined;
    }

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return structuredClone(job);
    }

    const queued: SaveGenerationJob = {
      id: job.id,
      ...(job.ownerUserId ? { ownerUserId: job.ownerUserId } : {}),
      status: "queued",
      phase: "queued",
      ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
      input
    };

    this.generationJobs.set(jobId, queued);
    return structuredClone(queued);
  }

  acceptGenerationJob(jobId: string, ownerUserId?: string): Save | undefined {
    const job = this.generationJobs.get(jobId);

    if (
      !job?.draft ||
      job.status === "cancelled" ||
      job.status === "failed" ||
      (ownerUserId && !ownerMatches(job.ownerUserId, ownerUserId))
    ) {
      return undefined;
    }

    const accepted = {
      ...job.draft.save,
      updatedAt: now()
    };

    this.saves.set(accepted.id, structuredClone(accepted));
    this.rollbackSnapshots.set(accepted.id, []);
    this.generationJobs.set(jobId, { ...job, status: "accepted", phase: "accepted" });

    return structuredClone(accepted);
  }

  importSave(input: Save, ownerUserId = defaultUser.id): Save {
    const imported = structuredClone(input);
    const importedId = this.saves.has(imported.id) ? id("save") : imported.id;
    const importedAt = now();
    const save: Save = {
      ...imported,
      id: importedId,
      ownerUserId,
      turns: imported.turns.map((turn) => ({ ...turn, saveId: importedId })),
      updatedAt: importedAt
    };

    this.saves.set(save.id, structuredClone(save));
    this.rollbackSnapshots.set(save.id, []);

    return structuredClone(save);
  }

  patchSave(saveId: string, patch: Partial<Pick<Save, "name" | "description" | "settings" | "worldMemory">>) {
    const save = this.saves.get(saveId);

    if (!save) {
      return undefined;
    }

    const updated = {
      ...save,
      ...patch,
      updatedAt: now()
    };

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  patchCharacter(saveId: string, characterId: string, patch: CharacterPatch) {
    const save = this.saves.get(saveId);

    if (!save) {
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

    const updated: Save = {
      ...save,
      characters: save.characters.map((item) =>
        item.id === characterId ? { ...item, ...changes, id: item.id } : item
      ),
      updatedAt: now()
    };

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  createCharacter(saveId: string, input: CreateCharacterInput) {
    const save = this.saves.get(saveId);

    if (!save || !save.locations.some((location) => location.id === input.locationId)) {
      return undefined;
    }

    const character: Character = {
      ...input,
      id: id("character")
    };
    const updated: Save = {
      ...save,
      characters: [...save.characters, character],
      updatedAt: now()
    };

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  deleteCharacter(saveId: string, characterId: string) {
    const save = this.saves.get(saveId);

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

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  createLocation(saveId: string, input: CreateLocationInput) {
    const save = this.saves.get(saveId);

    if (!save) {
      return undefined;
    }

    const location: Location = {
      ...input,
      id: id("location")
    };
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

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  patchLocation(saveId: string, locationId: string, patch: LocationPatch) {
    const save = this.saves.get(saveId);

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

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  deleteLocation(saveId: string, locationId: string) {
    const save = this.saves.get(saveId);

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

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  createRelationship(saveId: string, input: CreateRelationshipInput) {
    const save = this.saves.get(saveId);

    if (!save || !relationshipCharactersExist(save, input.sourceCharacterId, input.targetCharacterId)) {
      return undefined;
    }

    const relationship: Relationship = {
      ...input,
      id: id("relationship")
    };
    const updated: Save = {
      ...save,
      relationships: [...save.relationships, relationship],
      updatedAt: now()
    };

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  patchRelationship(saveId: string, relationshipId: string, patch: RelationshipPatch) {
    const save = this.saves.get(saveId);
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

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  deleteRelationship(saveId: string, relationshipId: string) {
    const save = this.saves.get(saveId);

    if (!save || !save.relationships.some((relationship) => relationship.id === relationshipId)) {
      return undefined;
    }

    const updated: Save = {
      ...save,
      relationships: save.relationships.filter((relationship) => relationship.id !== relationshipId),
      updatedAt: now()
    };

    this.saves.set(saveId, updated);
    return structuredClone(updated);
  }

  createTurnJob(
    saveId: string,
    input: CreateTurnInput,
    orchestration?: TurnOrchestrationOutput,
    llmCall?: LlmCallSummary
  ): TurnJob | undefined {
    const save = this.saves.get(saveId);

    if (!save) {
      return undefined;
    }

    if (input.idempotencyKey) {
      const existing = this.getTurnJobByIdempotencyKey(
        saveId,
        input.idempotencyKey,
        save.ownerUserId ?? defaultUser.id
      );

      if (existing) {
        return existing;
      }
    }

    const active = this.getActiveTurnJob(saveId);

    if (active) {
      return active;
    }

    const { job } = buildTurnDraft(
      save,
      input,
      this.getModelCredentials({ saveId }).model,
      undefined,
      undefined,
      orchestration,
      llmCall
    );
    this.turnJobs.set(job.id, job);

    return structuredClone(job);
  }

  createQueuedTurnJob(saveId: string, input: CreateTurnInput): TurnJob | undefined {
    const save = this.saves.get(saveId);

    if (!save) {
      return undefined;
    }

    if (input.idempotencyKey) {
      const existing = this.getTurnJobByIdempotencyKey(
        saveId,
        input.idempotencyKey,
        save.ownerUserId ?? defaultUser.id
      );

      if (existing) {
        return existing;
      }
    }

    const active = this.getActiveTurnJob(saveId);

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

    this.turnJobs.set(job.id, job);
    return structuredClone(job);
  }

  createFailedTurnJob(
    saveId: string,
    input: CreateTurnInput,
    failure: JobFailure,
    llmCall?: LlmCallSummary
  ): TurnJob | undefined {
    const save = this.saves.get(saveId);

    if (!save) {
      return undefined;
    }

    if (input.idempotencyKey) {
      const existing = this.getTurnJobByIdempotencyKey(
        saveId,
        input.idempotencyKey,
        save.ownerUserId ?? defaultUser.id
      );

      if (existing) {
        return existing;
      }
    }

    const active = this.getActiveTurnJob(saveId);

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

    this.turnJobs.set(job.id, job);
    return structuredClone(job);
  }

  getTurnJobByIdempotencyKey(saveId: string, idempotencyKey: string, ownerUserId?: string): TurnJob | undefined {
    const job = [...this.turnJobs.values()].find(
      (item) =>
        item.saveId === saveId &&
        item.idempotencyKey === idempotencyKey &&
        (!ownerUserId || ownerMatches(item.ownerUserId, ownerUserId))
    );
    return job ? structuredClone(job) : undefined;
  }

  getActiveTurnJob(saveId: string): TurnJob | undefined {
    const job = [...this.turnJobs.values()].find((item) => item.saveId === saveId && isActiveJobStatus(item.status));
    return job ? structuredClone(job) : undefined;
  }

  listActiveTurnJobs(): TurnJob[] {
    return [...this.turnJobs.values()]
      .filter((job) => isActiveJobStatus(job.status))
      .map((job) => structuredClone(job));
  }

  startTurnJob(jobId: string, phase: string): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);

    if (!job || job.status !== "queued") {
      return job ? structuredClone(job) : undefined;
    }

    const running: TurnJob = {
      ...job,
      status: "running",
      phase
    };

    this.turnJobs.set(jobId, running);
    return structuredClone(running);
  }

  completeTurnJob(
    jobId: string,
    orchestration: TurnOrchestrationOutput,
    llmCall?: LlmCallSummary
  ): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);

    if (!job || job.status === "cancelled" || job.status === "accepted") {
      return undefined;
    }

    const save = this.saves.get(job.saveId);

    if (!save) {
      return undefined;
    }

    const { job: completed } = buildTurnDraft(
      save,
      job.input ?? {},
      this.getModelCredentials({ saveId: job.saveId }).model,
      job.id,
      job.idempotencyKey,
      orchestration,
      llmCall
    );

    this.turnJobs.set(jobId, completed);
    return structuredClone(completed);
  }

  failTurnJob(jobId: string, failure: JobFailure, llmCall?: LlmCallSummary): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);

    if (!job) {
      return undefined;
    }

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

    this.turnJobs.set(jobId, failed);
    return structuredClone(failed);
  }

  patchTurnDraft(jobId: string, input: PatchTurnDraftInput): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);

    if (!job) {
      return undefined;
    }

    const patched = patchTurnJobDraft(job, input);

    if (!patched) {
      return undefined;
    }

    this.turnJobs.set(jobId, patched);
    return structuredClone(patched);
  }

  cancelTurnJob(jobId: string): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);

    if (!job) {
      return undefined;
    }

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

    this.turnJobs.set(jobId, cancelled);
    return structuredClone(cancelled);
  }

  retryTurnJob(jobId: string, orchestration?: TurnOrchestrationOutput, llmCall?: LlmCallSummary): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);

    if (!job) {
      return undefined;
    }

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return structuredClone(job);
    }

    const save = this.saves.get(job.saveId);

    if (!save) {
      return undefined;
    }

    const { job: retried } = buildTurnDraft(
      save,
      job.input ?? {},
      this.getModelCredentials({ saveId: job.saveId }).model,
      job.id,
      job.idempotencyKey,
      orchestration,
      llmCall
    );

    this.turnJobs.set(jobId, retried);

    return structuredClone(retried);
  }

  queueTurnRetry(jobId: string): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);

    if (!job) {
      return undefined;
    }

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return structuredClone(job);
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

    this.turnJobs.set(jobId, queued);
    return structuredClone(queued);
  }

  acceptTurn(turnId: string, ownerUserId?: string): Save | undefined {
    const jobEntry = [...this.turnJobs.entries()].find(([, job]) => job.turn?.id === turnId);

    if (!jobEntry) {
      return undefined;
    }

    const [jobId, job] = jobEntry;

    if (ownerUserId && !ownerMatches(job.ownerUserId, ownerUserId)) {
      return undefined;
    }
    const save = this.saves.get(job.saveId);

    if (!save) {
      return undefined;
    }

    const updatedSave = applyTurnDraft(save, job);

    if (!updatedSave || !job.turn) {
      return undefined;
    }

    const snapshots = this.rollbackSnapshots.get(save.id) ?? [];
    const acceptedTurn: Turn = { ...job.turn, status: "accepted" };

    this.rollbackSnapshots.set(save.id, [...snapshots, structuredClone(save)]);
    this.turnJobs.set(jobId, { ...job, status: "accepted", phase: "accepted", turn: acceptedTurn });
    this.saves.set(save.id, updatedSave);
    return structuredClone(updatedSave);
  }

  rollbackSave(saveId: string): Save | undefined {
    const snapshots = this.rollbackSnapshots.get(saveId) ?? [];
    const previous = snapshots.at(-1);
    const current = this.saves.get(saveId);

    if (!previous) {
      return undefined;
    }

    const remaining = snapshots.slice(0, -1);
    const restored: Save = {
      ...previous,
      turns: mergeTurns(previous.turns, current?.turns ?? []),
      updatedAt: now()
    };

    this.rollbackSnapshots.set(saveId, remaining);
    this.saves.set(saveId, structuredClone(restored));

    return structuredClone(restored);
  }

  getTurnJob(jobId: string, ownerUserId?: string): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);
    if (!job || (ownerUserId && !ownerMatches(job.ownerUserId, ownerUserId))) {
      return undefined;
    }
    return job ? structuredClone(job) : undefined;
  }
}

export const prototypeStore = new PrototypeStore();

export function buildSave(input: CreateSaveInput, generatedDraft?: GeneratedWorldDraft): Save {
  if (generatedDraft) {
    return buildGeneratedSave(input, generatedDraft);
  }

  const createdAt = now();
  const template = getWorldTemplate(input.templateId);
  const language = input.settings.language;
  const premise = input.premise.trim() || template.premise[language];
  const location: Location = {
    id: id("location"),
    name: template.location.name[language],
    description: template.location.description[language],
    status: template.location.status[language]
  };
  const fallbackSeeds = template.characterSeeds[language];
  const trimmedSeeds = input.characterSeeds.map((seed) => seed.trim()).filter(Boolean);
  const seeds = (trimmedSeeds.length >= 3 ? trimmedSeeds : [...trimmedSeeds, ...fallbackSeeds]).slice(0, 8);
  const characters = seeds.map<Character>((seed, index) => ({
    id: id("character"),
    name: seed || (language === "zh" ? `角色 ${index + 1}` : `Character ${index + 1}`),
    profile:
      language === "zh"
        ? `${seed} 被卷入了《${input.name}》的核心冲突：${premise}`
        : `${seed} has been pulled into the central conflict of ${input.name}: ${premise}`,
    personality: language === "zh" ? "谨慎、执着、会隐藏真实动机" : "Careful, driven, and private",
    longTermGoal: language === "zh" ? "保护自己珍视的东西" : "Protect what matters most",
    shortTermGoal: language === "zh" ? "弄清当前局势的真正威胁" : "Understand the immediate threat",
    locationId: location.id,
    status: language === "zh" ? "可行动" : "Available",
    secrets: [language === "zh" ? "掌握一条尚未公开的线索" : "Knows one unrevealed lead"],
    privateMemory: [language === "zh" ? "记得世界刚刚开始运转" : "Remembers the world beginning to move"]
  }));
  const relationships = characters.slice(1).map<Relationship>((character, index) => ({
    id: id("relationship"),
    sourceCharacterId: characters[0]?.id ?? character.id,
    targetCharacterId: character.id,
    label: language === "zh" ? (index % 2 === 0 ? "信任" : "试探") : index % 2 === 0 ? "Trust" : "Testing",
    strength: index % 2 === 0 ? 35 : 10,
    summary: language === "zh" ? "彼此有合作空间，但仍保留秘密。" : "They can cooperate, but both still keep secrets."
  }));

  return {
    id: id("save"),
    name: input.name,
    description: premise,
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    turnNumber: 0,
    saveSeed: id("seed"),
    settings: input.settings,
    ...saveModelConfigFromInput(input),
    worldMemory: {
      timeline: [],
      worldSummary: premise,
      locationSummaries: {
        [location.id]: location.description
      }
    },
    characters,
    locations: [location],
    relationships,
    turns: [],
    createdAt,
    updatedAt: createdAt
  };
}

export function buildGeneratedWorldDraft(input: CreateSaveInput): GeneratedWorldDraft {
  const template = getWorldTemplate(input.templateId);
  const language = input.settings.language;
  const premise = input.premise.trim() || template.premise[language];
  const seeds = input.characterSeeds
    .map((seed) => seed.trim())
    .filter(Boolean)
    .slice(0, 8);
  const locationName = template.location.name[language];

  return {
    description: premise,
    worldSummary: premise,
    locations: [
      {
        name: locationName,
        description: template.location.description[language],
        status: template.location.status[language]
      }
    ],
    characters: seeds.map((seed) => ({
      name: seed,
      profile:
        language === "zh"
          ? `${seed} 被卷入了《${input.name}》的核心冲突：${premise}`
          : `${seed} has been pulled into the central conflict of ${input.name}: ${premise}`,
      personality: language === "zh" ? "谨慎、执着、会隐藏真实动机" : "Careful, driven, and private",
      longTermGoal: language === "zh" ? "保护自己珍视的东西" : "Protect what matters most",
      shortTermGoal: language === "zh" ? "弄清当前局势的真正威胁" : "Understand the immediate threat",
      locationName,
      status: language === "zh" ? "可行动" : "Available",
      secrets: [language === "zh" ? "掌握一条尚未公开的线索" : "Knows one unrevealed lead"],
      privateMemory: [language === "zh" ? "记得世界刚刚开始运转" : "Remembers the world beginning to move"]
    })),
    relationships: seeds.slice(1).map((seed, index) => ({
      sourceCharacterName: seeds[0] ?? seed,
      targetCharacterName: seed,
      label: language === "zh" ? (index % 2 === 0 ? "信任" : "试探") : index % 2 === 0 ? "Trust" : "Testing",
      strength: index % 2 === 0 ? 35 : 10,
      summary: language === "zh" ? "彼此有合作空间，但仍保留秘密。" : "They can cooperate, but both still keep secrets."
    }))
  };
}

function saveModelConfigFromInput(input: CreateSaveInput): { modelConfig?: ModelConfig } {
  if (!input.modelOverride?.baseUrl && !input.modelOverride?.model) {
    return {};
  }

  return {
    modelConfig: {
      ...publicSaveModelConfig(defaultModelConfig),
      ...input.modelOverride
    }
  };
}

function buildGeneratedSave(input: CreateSaveInput, generatedDraft: GeneratedWorldDraft): Save {
  const createdAt = now();
  const locationDrafts = generatedDraft.locations.slice(0, 5);
  const locations = locationDrafts.map<Location>((location) => ({
    id: id("location"),
    name: location.name,
    description: location.description,
    status: location.status
  }));
  const locationByName = new Map(locations.map((location) => [normalizeName(location.name), location]));
  const fallbackLocation = locations[0];
  const characters = generatedDraft.characters.slice(0, 8).map<Character>((character) => ({
    id: id("character"),
    name: character.name,
    profile: character.profile,
    personality: character.personality,
    longTermGoal: character.longTermGoal,
    shortTermGoal: character.shortTermGoal,
    locationId:
      locationByName.get(normalizeName(character.locationName ?? ""))?.id ?? fallbackLocation?.id ?? id("location"),
    status: character.status,
    secrets: character.secrets,
    privateMemory: character.privateMemory
  }));
  const characterByName = new Map(characters.map((character) => [normalizeName(character.name), character]));
  const relationships = generatedDraft.relationships
    .map<Relationship | undefined>((relationship) => {
      const source = characterByName.get(normalizeName(relationship.sourceCharacterName));
      const target = characterByName.get(normalizeName(relationship.targetCharacterName));

      if (!source || !target || source.id === target.id) {
        return undefined;
      }

      return {
        id: id("relationship"),
        sourceCharacterId: source.id,
        targetCharacterId: target.id,
        label: relationship.label,
        strength: clampRelationshipStrength(relationship.strength),
        summary: relationship.summary
      };
    })
    .filter((relationship): relationship is Relationship => Boolean(relationship));

  return {
    id: id("save"),
    name: input.name,
    description: generatedDraft.description,
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    turnNumber: 0,
    saveSeed: id("seed"),
    settings: input.settings,
    ...saveModelConfigFromInput(input),
    worldMemory: {
      timeline: [],
      worldSummary: generatedDraft.worldSummary,
      locationSummaries: Object.fromEntries(locations.map((location) => [location.id, location.description]))
    },
    characters,
    locations,
    relationships: relationships.length > 0 ? relationships : buildFallbackRelationships(characters, input),
    turns: [],
    createdAt,
    updatedAt: createdAt
  };
}

function buildFallbackRelationships(characters: Character[], input: CreateSaveInput): Relationship[] {
  return characters.slice(1).map((character, index) => ({
    id: id("relationship"),
    sourceCharacterId: characters[0]?.id ?? character.id,
    targetCharacterId: character.id,
    label:
      input.settings.language === "zh" ? (index % 2 === 0 ? "信任" : "试探") : index % 2 === 0 ? "Trust" : "Testing",
    strength: index % 2 === 0 ? 35 : 10,
    summary:
      input.settings.language === "zh"
        ? "彼此有合作空间，但仍保留秘密。"
        : "They can cooperate, but both still keep secrets."
  }));
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function normalizeUsername(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized || defaultUser.username;
}

function ownerMatches(ownerUserId: string | undefined, requestedUserId: string) {
  return (ownerUserId ?? defaultUser.id) === requestedUserId;
}

export function isActiveJobStatus(status: JobStatus) {
  return status === "queued" || status === "running" || status === "needs_review";
}

export function buildTurnDraft(
  save: Save,
  input: CreateTurnInput,
  model: string,
  jobId = id("turn_job"),
  idempotencyKey = input.idempotencyKey,
  orchestration = createTurnOrchestration(save, input),
  llmCall?: LlmCallSummary
) {
  const turnNumber = save.turnNumber + 1;
  const branchContext = resolveBranchContext(save);
  const event =
    orchestration.focus.locationId !== undefined
      ? {
          id: id("event"),
          title: orchestration.event.title,
          body: orchestration.event.body,
          involvedCharacterIds: orchestration.focus.characterIds,
          locationId: orchestration.focus.locationId,
          dialogue: orchestration.event.dialogue
        }
      : {
          id: id("event"),
          title: orchestration.event.title,
          body: orchestration.event.body,
          involvedCharacterIds: orchestration.focus.characterIds,
          dialogue: orchestration.event.dialogue
        };
  const turn: Turn = {
    id: id("turn"),
    saveId: save.id,
    ...branchContext,
    turnNumber,
    status: "needs_review",
    events: [event],
    stateChanges: orchestration.stateChanges.map((change) => ({ ...change, id: id("change") })),
    callSummary: {
      model,
      calls: llmCall ? 1 : 1 + orchestration.characterPlans.length,
      durationMs: llmCall?.latencyMs ?? 320 + orchestration.characterPlans.length * 90,
      estimatedTokens: llmCall?.estimatedTokens ?? 900 + orchestration.characterPlans.length * 180,
      ...(llmCall
        ? {
            provider: llmCall.provider,
            status: llmCall.status,
            ...(llmCall.inputTokens !== undefined ? { inputTokens: llmCall.inputTokens } : {}),
            ...(llmCall.outputTokens !== undefined ? { outputTokens: llmCall.outputTokens } : {}),
            ...(llmCall.totalTokens !== undefined ? { totalTokens: llmCall.totalTokens } : {}),
            ...(llmCall.estimatedUsage !== undefined ? { estimatedUsage: llmCall.estimatedUsage } : {}),
            ...(llmCall.estimatedCostUsd !== undefined ? { estimatedCostUsd: llmCall.estimatedCostUsd } : {}),
            ...(llmCall.inputTokenPriceUsdPerMillion !== undefined
              ? { inputTokenPriceUsdPerMillion: llmCall.inputTokenPriceUsdPerMillion }
              : {}),
            ...(llmCall.outputTokenPriceUsdPerMillion !== undefined
              ? { outputTokenPriceUsdPerMillion: llmCall.outputTokenPriceUsdPerMillion }
              : {})
          }
        : {})
    },
    createdAt: now()
  };
  const updatedCharacters = save.characters.map((character) => {
    const memoryUpdate = orchestration.memoryUpdates.find((update) => update.characterId === character.id);

    if (!memoryUpdate) {
      return character;
    }

    return {
      ...character,
      status:
        save.settings.language === "zh"
          ? `卷入：${orchestration.focus.conflict}`
          : `Engaged: ${orchestration.focus.conflict}`,
      privateMemory: [...character.privateMemory, memoryUpdate.entry]
    };
  });
  const updatedRelationships = save.relationships.map((relationship) => {
    const update = orchestration.relationshipUpdates.find((item) => item.relationshipId === relationship.id);

    if (!update) {
      return relationship;
    }

    return {
      ...relationship,
      strength: clampRelationshipStrength(relationship.strength + update.strengthDelta),
      summary: update.summary
    };
  });
  const draftState: TurnDraftState = {
    worldMemory: orchestration.worldMemory,
    characterUpdates: updatedCharacters
      .filter((character) => {
        const current = save.characters.find((item) => item.id === character.id);
        return (
          current &&
          (current.status !== character.status ||
            current.longTermGoal !== character.longTermGoal ||
            current.shortTermGoal !== character.shortTermGoal ||
            current.privateMemory.join("\n") !== character.privateMemory.join("\n"))
        );
      })
      .map((character) => ({
        characterId: character.id,
        status: character.status,
        longTermGoal: character.longTermGoal,
        shortTermGoal: character.shortTermGoal,
        privateMemory: character.privateMemory
      })),
    relationshipUpdates: updatedRelationships
      .filter((relationship) => {
        const current = save.relationships.find((item) => item.id === relationship.id);
        return current && (current.strength !== relationship.strength || current.summary !== relationship.summary);
      })
      .map((relationship) => ({
        relationshipId: relationship.id,
        strength: relationship.strength,
        summary: relationship.summary
      }))
  };
  const updatedSave: Save = {
    ...save,
    turnNumber,
    characters: updatedCharacters,
    relationships: updatedRelationships,
    turns: [...save.turns, turn],
    headTurnId: turn.id,
    currentBranchId: branchContext.branchId,
    worldMemory: {
      ...save.worldMemory,
      timeline: [...save.worldMemory.timeline, orchestration.worldMemory.timelineEntry],
      worldSummary: `${save.worldMemory.worldSummary}\n${orchestration.worldMemory.summaryDelta}`
    },
    updatedAt: now()
  };
  const job: TurnJob = {
    id: jobId,
    saveId: save.id,
    ...(save.ownerUserId ? { ownerUserId: save.ownerUserId } : {}),
    status: "needs_review",
    phase: "ready_for_review",
    input,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(llmCall ? { llmCall } : {}),
    turn,
    draftState
  };

  return { job, updatedSave };
}

function resolveBranchContext(save: Save): { parentTurnId?: string; branchId: string } {
  const latestCurrentTurn = save.turns.filter((turn) => turn.turnNumber === save.turnNumber).at(-1);
  const parentTurnId = save.headTurnId ?? (save.turnNumber > 0 ? latestCurrentTurn?.id : undefined);
  const parentTurn = parentTurnId ? save.turns.find((turn) => turn.id === parentTurnId) : undefined;
  const hasExistingFuture = parentTurnId
    ? save.turns.some((turn) => turn.parentTurnId === parentTurnId)
    : save.turns.length > 0;
  const branchId = hasExistingFuture ? id("branch") : (parentTurn?.branchId ?? save.currentBranchId ?? "branch_main");

  return {
    ...(parentTurnId ? { parentTurnId } : {}),
    branchId
  };
}

function mergeTurns(...turnGroups: Turn[][]): Turn[] {
  const byId = new Map<string, Turn>();

  for (const turn of turnGroups.flat()) {
    byId.set(turn.id, turn);
  }

  return [...byId.values()].sort((left, right) => {
    if (left.turnNumber !== right.turnNumber) {
      return left.turnNumber - right.turnNumber;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function patchTurnJobDraft(job: TurnJob, input: PatchTurnDraftInput): TurnJob | undefined {
  if (job.status !== "needs_review" || !job.turn || !job.draftState) {
    return undefined;
  }

  const [primaryEvent, ...remainingEvents] = job.turn.events;
  const events =
    input.event && primaryEvent
      ? [
          {
            ...primaryEvent,
            title: input.event.title ?? primaryEvent.title,
            body: input.event.body ?? primaryEvent.body
          },
          ...remainingEvents
        ]
      : job.turn.events;
  const draftState: TurnDraftState = {
    ...job.draftState,
    characterUpdates: mergeCharacterDraftUpdates(job.draftState.characterUpdates, input.characterUpdates ?? []),
    relationshipUpdates: mergeRelationshipDraftUpdates(
      job.draftState.relationshipUpdates,
      input.relationshipUpdates ?? []
    )
  };

  return {
    ...job,
    phase: "ready_for_review",
    turn: {
      ...job.turn,
      events,
      stateChanges: input.stateChanges ?? job.turn.stateChanges
    },
    draftState
  };
}

export function applyTurnDraft(save: Save, job: TurnJob): Save | undefined {
  if (!job.turn || !job.draftState) {
    return undefined;
  }

  const acceptedTurn: Turn = {
    ...job.turn,
    status: "accepted"
  };
  const characterUpdates = new Map(job.draftState.characterUpdates.map((update) => [update.characterId, update]));
  const relationshipUpdates = new Map(
    job.draftState.relationshipUpdates.map((update) => [update.relationshipId, update])
  );
  const characters = save.characters.map((character) => {
    const update = characterUpdates.get(character.id);

    if (!update) {
      return character;
    }

    return {
      ...character,
      status: update.status ?? character.status,
      longTermGoal: update.longTermGoal ?? character.longTermGoal,
      shortTermGoal: update.shortTermGoal ?? character.shortTermGoal,
      privateMemory: update.privateMemory ?? character.privateMemory
    };
  });
  const relationships = save.relationships.map((relationship) => {
    const update = relationshipUpdates.get(relationship.id);

    if (!update) {
      return relationship;
    }

    return {
      ...relationship,
      strength: update.strength ?? relationship.strength,
      summary: update.summary ?? relationship.summary
    };
  });
  const primaryEvent = acceptedTurn.events[0];
  const timelineEntry = primaryEvent
    ? `${acceptedTurn.turnNumber}. ${primaryEvent.title}: ${primaryEvent.body}`
    : job.draftState.worldMemory.timelineEntry;

  return {
    ...save,
    turnNumber: acceptedTurn.turnNumber,
    headTurnId: acceptedTurn.id,
    ...(acceptedTurn.branchId ? { currentBranchId: acceptedTurn.branchId } : {}),
    characters,
    relationships,
    turns: [...save.turns.filter((turn) => turn.id !== acceptedTurn.id), acceptedTurn],
    worldMemory: {
      ...save.worldMemory,
      timeline: [...save.worldMemory.timeline, timelineEntry],
      worldSummary: `${save.worldMemory.worldSummary}\n${job.draftState.worldMemory.summaryDelta}`
    },
    updatedAt: now()
  };
}

function mergeCharacterDraftUpdates(
  current: TurnDraftState["characterUpdates"],
  incoming: TurnDraftState["characterUpdates"]
) {
  const updates = new Map(current.map((update) => [update.characterId, update]));

  for (const update of incoming) {
    updates.set(update.characterId, {
      ...(updates.get(update.characterId) ?? { characterId: update.characterId }),
      ...update
    });
  }

  return [...updates.values()];
}

function mergeRelationshipDraftUpdates(
  current: TurnDraftState["relationshipUpdates"],
  incoming: TurnDraftState["relationshipUpdates"]
) {
  const updates = new Map(current.map((update) => [update.relationshipId, update]));

  for (const update of incoming) {
    updates.set(update.relationshipId, {
      ...(updates.get(update.relationshipId) ?? { relationshipId: update.relationshipId }),
      ...update
    });
  }

  return [...updates.values()];
}

function relationshipCharactersExist(save: Save, sourceCharacterId: string, targetCharacterId: string) {
  return (
    sourceCharacterId !== targetCharacterId &&
    save.characters.some((character) => character.id === sourceCharacterId) &&
    save.characters.some((character) => character.id === targetCharacterId)
  );
}
