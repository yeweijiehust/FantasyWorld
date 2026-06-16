import type {
  CharacterPatch,
  CreateSaveInput,
  CreateTurnInput,
  ModelConfig,
  Save,
  SaveGenerationJob,
  SaveImport,
  SaveListItem,
  TurnJob
} from "@fantasy-world/shared";

export type FantasyWorldStore = {
  getModelConfig(): ModelConfig | Promise<ModelConfig>;
  updateModelConfig(input: Partial<ModelConfig> & { apiKey?: string }): ModelConfig | Promise<ModelConfig>;
  listSaves(): SaveListItem[] | Promise<SaveListItem[]>;
  getSave(saveId: string): Save | undefined | Promise<Save | undefined>;
  createGenerationJob(input: CreateSaveInput): SaveGenerationJob | Promise<SaveGenerationJob>;
  getGenerationJob(jobId: string): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  acceptGenerationJob(jobId: string): Save | undefined | Promise<Save | undefined>;
  importSave(input: SaveImport): Save | Promise<Save>;
  patchSave(
    saveId: string,
    patch: Partial<Pick<Save, "name" | "description" | "settings" | "worldMemory">>
  ): Save | undefined | Promise<Save | undefined>;
  patchCharacter(
    saveId: string,
    characterId: string,
    patch: CharacterPatch
  ): Save | undefined | Promise<Save | undefined>;
  createTurnJob(saveId: string, input: CreateTurnInput): TurnJob | undefined | Promise<TurnJob | undefined>;
  acceptTurn(turnId: string): Save | undefined | Promise<Save | undefined>;
  rollbackSave(saveId: string): Save | undefined | Promise<Save | undefined>;
  getTurnJob(jobId: string): TurnJob | undefined | Promise<TurnJob | undefined>;
};
