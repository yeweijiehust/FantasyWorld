import type {
  Character,
  CreateSaveInput,
  CreateTurnInput,
  JobStatus,
  Location,
  ModelConfig,
  CharacterPatch,
  Relationship,
  Save,
  SaveGenerationJob,
  SaveImport,
  SaveListItem,
  Turn,
  TurnJob
} from "@fantasy-world/shared";
import { getWorldTemplate } from "@fantasy-world/shared";
import { clampRelationshipStrength, createTurnOrchestration } from "../turn/orchestrator.js";
import type { FantasyWorldStore, ModelCredentials } from "./types.js";

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

export class PrototypeStore implements FantasyWorldStore {
  private readonly saves = new Map<string, Save>();
  private readonly generationJobs = new Map<string, SaveGenerationJob>();
  private readonly turnJobs = new Map<string, TurnJob>();
  private readonly rollbackSnapshots = new Map<string, Save[]>();
  private readonly sessions = new Map<string, number>();
  private modelConfig: ModelConfig = defaultModelConfig;
  private modelApiKey: string | undefined;

  getSession() {
    return { authenticated: true };
  }

  createSession() {
    const sessionId = id("session");
    this.sessions.set(sessionId, Date.now() + sessionTtlMs);
    return sessionId;
  }

  hasSession(sessionId: string | undefined) {
    if (!sessionId) {
      return false;
    }

    const expiresAt = this.sessions.get(sessionId);

    if (!expiresAt || expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }

    return true;
  }

  deleteSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  getModelConfig() {
    return structuredClone(this.modelConfig);
  }

  getModelCredentials() {
    const credentials: ModelCredentials = {
      ...this.modelConfig
    };

    if (this.modelApiKey) {
      credentials.apiKey = this.modelApiKey;
    }

    return structuredClone(credentials);
  }

  updateModelConfig(input: Partial<ModelConfig> & { apiKey?: string }) {
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

  listSaves(): SaveListItem[] {
    return [...this.saves.values()].map((save) => ({
      id: save.id,
      name: save.name,
      description: save.description,
      language: save.settings.language,
      turnNumber: save.turnNumber,
      characterCount: save.characters.length,
      updatedAt: save.updatedAt
    }));
  }

  getSave(saveId: string): Save | undefined {
    const save = this.saves.get(saveId);
    return save ? structuredClone(save) : undefined;
  }

  createGenerationJob(input: CreateSaveInput): SaveGenerationJob {
    if (input.idempotencyKey) {
      const existing = [...this.generationJobs.values()].find((job) => job.idempotencyKey === input.idempotencyKey);

      if (existing) {
        return structuredClone(existing);
      }
    }

    const save = buildSave(input);
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

    this.generationJobs.set(job.id, job);
    return structuredClone(job);
  }

  getGenerationJob(jobId: string): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  }

  cancelGenerationJob(jobId: string): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);

    if (!job) {
      return undefined;
    }

    if (!isActiveJobStatus(job.status)) {
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

  retryGenerationJob(jobId: string): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);

    if (!job?.draft) {
      return undefined;
    }

    if (isActiveJobStatus(job.status) || job.status === "accepted") {
      return structuredClone(job);
    }

    const save = buildSave(job.draft.input);
    const retried: SaveGenerationJob = {
      id: job.id,
      status: "needs_review",
      phase: "ready_for_review",
      ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
      draft: {
        ...job.draft,
        id: id("draft"),
        save,
        createdAt: now()
      }
    };

    this.generationJobs.set(jobId, retried);
    return structuredClone(retried);
  }

  acceptGenerationJob(jobId: string): Save | undefined {
    const job = this.generationJobs.get(jobId);

    if (!job?.draft || job.status === "cancelled" || job.status === "failed") {
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

  importSave(input: SaveImport): Save {
    const imported = structuredClone(input);
    const importedId = this.saves.has(imported.id) ? id("save") : imported.id;
    const importedAt = now();
    const save: Save = {
      ...imported,
      id: importedId,
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

  createTurnJob(saveId: string, input: CreateTurnInput): TurnJob | undefined {
    const save = this.saves.get(saveId);

    if (!save) {
      return undefined;
    }

    if (input.idempotencyKey) {
      const existing = [...this.turnJobs.values()].find(
        (job) => job.saveId === saveId && job.idempotencyKey === input.idempotencyKey
      );

      if (existing) {
        return structuredClone(existing);
      }
    }

    const active = [...this.turnJobs.values()].find((job) => job.saveId === saveId && isActiveJobStatus(job.status));

    if (active) {
      return structuredClone(active);
    }

    const { job, updatedSave } = buildTurnDraft(save, input, this.modelConfig.model);

    const snapshots = this.rollbackSnapshots.get(saveId) ?? [];
    this.rollbackSnapshots.set(saveId, [...snapshots, structuredClone(save)]);
    this.saves.set(saveId, updatedSave);
    this.turnJobs.set(job.id, job);

    return structuredClone(job);
  }

  cancelTurnJob(jobId: string): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);

    if (!job) {
      return undefined;
    }

    if (!isActiveJobStatus(job.status)) {
      return structuredClone(job);
    }

    if (job.turn) {
      const save = this.saves.get(job.saveId);
      const snapshots = this.rollbackSnapshots.get(job.saveId) ?? [];
      const previous = snapshots.at(-1);

      if (save?.turns.some((turn) => turn.id === job.turn?.id) && previous) {
        this.rollbackSnapshots.set(job.saveId, snapshots.slice(0, -1));
        this.saves.set(job.saveId, structuredClone({ ...previous, updatedAt: now() }));
      }
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

  retryTurnJob(jobId: string): TurnJob | undefined {
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

    const { job: retried, updatedSave } = buildTurnDraft(
      save,
      job.input ?? {},
      this.modelConfig.model,
      job.id,
      job.idempotencyKey
    );
    const snapshots = this.rollbackSnapshots.get(job.saveId) ?? [];

    this.rollbackSnapshots.set(job.saveId, [...snapshots, structuredClone(save)]);
    this.saves.set(job.saveId, updatedSave);
    this.turnJobs.set(jobId, retried);

    return structuredClone(retried);
  }

  acceptTurn(turnId: string): Save | undefined {
    const save = [...this.saves.values()].find((item) => item.turns.some((turn) => turn.id === turnId));

    if (!save) {
      return undefined;
    }

    const updatedTurns = save.turns.map((turn) =>
      turn.id === turnId ? { ...turn, status: "accepted" as const } : turn
    );
    const updatedSave: Save = {
      ...save,
      turns: updatedTurns,
      updatedAt: now()
    };

    for (const [jobId, job] of this.turnJobs.entries()) {
      if (job.turn?.id === turnId) {
        this.turnJobs.set(jobId, { ...job, status: "accepted", turn: { ...job.turn, status: "accepted" } });
      }
    }

    this.saves.set(save.id, updatedSave);
    return structuredClone(updatedSave);
  }

  rollbackSave(saveId: string): Save | undefined {
    const snapshots = this.rollbackSnapshots.get(saveId) ?? [];
    const previous = snapshots.at(-1);

    if (!previous) {
      return undefined;
    }

    const remaining = snapshots.slice(0, -1);
    const restored: Save = {
      ...previous,
      updatedAt: now()
    };

    this.rollbackSnapshots.set(saveId, remaining);
    this.saves.set(saveId, structuredClone(restored));

    return structuredClone(restored);
  }

  getTurnJob(jobId: string): TurnJob | undefined {
    const job = this.turnJobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  }
}

export const prototypeStore = new PrototypeStore();

export function buildSave(input: CreateSaveInput): Save {
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
    schemaVersion: "1",
    turnNumber: 0,
    saveSeed: id("seed"),
    settings: input.settings,
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

export function isActiveJobStatus(status: JobStatus) {
  return status === "queued" || status === "running" || status === "needs_review";
}

export function buildTurnDraft(
  save: Save,
  input: CreateTurnInput,
  model: string,
  jobId = id("turn_job"),
  idempotencyKey = input.idempotencyKey
) {
  const turnNumber = save.turnNumber + 1;
  const orchestration = createTurnOrchestration(save, input);
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
    turnNumber,
    status: "needs_review",
    events: [event],
    stateChanges: orchestration.stateChanges.map((change) => ({ ...change, id: id("change") })),
    callSummary: {
      model,
      calls: 1 + orchestration.characterPlans.length,
      durationMs: 320 + orchestration.characterPlans.length * 90,
      estimatedTokens: 900 + orchestration.characterPlans.length * 180
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
  const updatedSave: Save = {
    ...save,
    turnNumber,
    characters: updatedCharacters,
    relationships: updatedRelationships,
    turns: [...save.turns, turn],
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
    status: "needs_review",
    phase: "ready_for_review",
    input,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    turn
  };

  return { job, updatedSave };
}
