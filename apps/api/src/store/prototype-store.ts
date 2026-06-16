import type {
  Character,
  CreateSaveInput,
  CreateTurnInput,
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
import type { FantasyWorldStore } from "./types.js";

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

export class PrototypeStore implements FantasyWorldStore {
  private readonly saves = new Map<string, Save>();
  private readonly generationJobs = new Map<string, SaveGenerationJob>();
  private readonly turnJobs = new Map<string, TurnJob>();
  private readonly rollbackSnapshots = new Map<string, Save[]>();
  private modelConfig: ModelConfig = defaultModelConfig;

  getSession() {
    return { authenticated: true };
  }

  getModelConfig() {
    return structuredClone(this.modelConfig);
  }

  updateModelConfig(input: Partial<ModelConfig> & { apiKey?: string }) {
    const { apiKey, ...modelInput } = input;
    const next: ModelConfig = {
      ...this.modelConfig,
      ...modelInput,
      hasApiKey: Boolean(apiKey) || this.modelConfig.hasApiKey,
      supportsJsonMode: true,
      supportsUsage: true,
      supportsStream: false
    };

    if (apiKey) {
      next.apiKeyTail = apiKey.slice(-4);
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

    this.generationJobs.set(job.id, job);
    return structuredClone(job);
  }

  getGenerationJob(jobId: string): SaveGenerationJob | undefined {
    const job = this.generationJobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  }

  acceptGenerationJob(jobId: string): Save | undefined {
    const job = this.generationJobs.get(jobId);

    if (!job?.draft) {
      return undefined;
    }

    const accepted = {
      ...job.draft.save,
      updatedAt: now()
    };

    this.saves.set(accepted.id, structuredClone(accepted));
    this.rollbackSnapshots.set(accepted.id, []);
    this.generationJobs.set(jobId, { ...job, status: "accepted" });

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

    const turnNumber = save.turnNumber + 1;
    const location = save.locations[0];
    const involved = save.characters.slice(0, Math.min(2, save.characters.length));
    const instruction = input.gmInstruction?.trim();
    const eventTitle = instruction ? "GM 指令改变了局势" : "世界自行推进";
    const eventBody = renderTurnEvent(save, involved, location, instruction);
    const event =
      location?.id !== undefined
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
        model: this.modelConfig.model,
        calls: 1,
        durationMs: 320,
        estimatedTokens: 900
      },
      createdAt: now()
    };

    const updatedSave: Save = {
      ...save,
      turnNumber,
      turns: [...save.turns, turn],
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

    const snapshots = this.rollbackSnapshots.get(saveId) ?? [];
    this.rollbackSnapshots.set(saveId, [...snapshots, structuredClone(save)]);
    this.saves.set(saveId, updatedSave);
    this.turnJobs.set(job.id, job);

    return structuredClone(job);
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
  const location: Location = {
    id: id("location"),
    name: input.settings.language === "zh" ? "边境港口" : "Frontier Harbor",
    description:
      input.settings.language === "zh"
        ? "一座夹在贸易、谣言和旧王国阴影之间的港口。"
        : "A harbor caught between trade, rumor, and the shadow of an old kingdom.",
    status: input.settings.language === "zh" ? "平静但暗流涌动" : "Calm with quiet pressure underneath"
  };
  const seeds = input.characterSeeds.length > 0 ? input.characterSeeds : ["守望者", "流亡继承人", "走私船长"];
  const characters = seeds.slice(0, 8).map<Character>((seed, index) => ({
    id: id("character"),
    name: seed || `Character ${index + 1}`,
    profile:
      input.settings.language === "zh"
        ? `${seed} 被卷入了 ${input.name} 的核心冲突。`
        : `${seed} has been pulled into the central conflict of ${input.name}.`,
    personality: input.settings.language === "zh" ? "谨慎、执着、会隐藏真实动机" : "Careful, driven, and private",
    longTermGoal: input.settings.language === "zh" ? "保护自己珍视的东西" : "Protect what matters most",
    shortTermGoal: input.settings.language === "zh" ? "弄清当前局势的真正威胁" : "Understand the immediate threat",
    locationId: location.id,
    status: input.settings.language === "zh" ? "可行动" : "Available",
    secrets: [input.settings.language === "zh" ? "掌握一条尚未公开的线索" : "Knows one unrevealed lead"],
    privateMemory: [input.settings.language === "zh" ? "记得世界刚刚开始运转" : "Remembers the world beginning to move"]
  }));
  const relationships = characters.slice(1).map<Relationship>((character, index) => ({
    id: id("relationship"),
    sourceCharacterId: characters[0]?.id ?? character.id,
    targetCharacterId: character.id,
    label: index % 2 === 0 ? "信任" : "试探",
    strength: index % 2 === 0 ? 35 : 10,
    summary:
      input.settings.language === "zh"
        ? "彼此有合作空间，但仍保留秘密。"
        : "They can cooperate, but both still keep secrets."
  }));

  return {
    id: id("save"),
    name: input.name,
    description: input.premise,
    schemaVersion: "1",
    turnNumber: 0,
    saveSeed: id("seed"),
    settings: input.settings,
    worldMemory: {
      timeline: [],
      worldSummary: input.premise,
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

export function renderTurnEvent(
  save: Save,
  characters: Character[],
  location: Location | undefined,
  instruction: string | undefined
) {
  const names = characters.map((character) => character.name).join("、");
  const place = location?.name ?? save.name;

  if (save.settings.language === "en") {
    const base = `${names || "The active cast"} notices a shift around ${place}.`;
    return instruction
      ? `${base} The GM directive takes hold: ${instruction}.`
      : `${base} Each character updates their next move.`;
  }

  const base = `${names || "活跃角色"}注意到${place}的局势发生了变化。`;
  return instruction ? `${base} GM 指令生效：${instruction}。` : `${base} 他们各自调整了下一步行动。`;
}
