import type {
  CharacterPatch,
  CreateCharacterInput,
  CreateLocationInput,
  CreateRelationshipInput,
  CreateSaveInput,
  CreateTurnInput,
  GeneratedWorldDraft,
  LocationPatch,
  ModelConfig,
  PatchTurnDraftInput,
  RelationshipPatch,
  Save,
  SaveGenerationJob,
  SaveListItem,
  TurnOrchestrationOutput,
  TurnJob
} from "@fantasy-world/shared";

export type ModelCredentials = ModelConfig & {
  apiKey?: string;
};

export type FantasyWorldStore = {
  createSession(): string | Promise<string>;
  hasSession(sessionId: string | undefined): boolean | Promise<boolean>;
  deleteSession(sessionId: string): void | Promise<void>;
  getModelConfig(): ModelConfig | Promise<ModelConfig>;
  getModelCredentials(): ModelCredentials | Promise<ModelCredentials>;
  updateModelConfig(input: Partial<ModelConfig> & { apiKey?: string }): ModelConfig | Promise<ModelConfig>;
  listSaves(): SaveListItem[] | Promise<SaveListItem[]>;
  getSave(saveId: string): Save | undefined | Promise<Save | undefined>;
  createGenerationJob(
    input: CreateSaveInput,
    generatedDraft?: GeneratedWorldDraft
  ): SaveGenerationJob | Promise<SaveGenerationJob>;
  getGenerationJobByIdempotencyKey(
    idempotencyKey: string
  ): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  getGenerationJob(jobId: string): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  cancelGenerationJob(jobId: string): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  retryGenerationJob(jobId: string): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  acceptGenerationJob(jobId: string): Save | undefined | Promise<Save | undefined>;
  importSave(input: Save): Save | Promise<Save>;
  patchSave(
    saveId: string,
    patch: Partial<Pick<Save, "name" | "description" | "settings" | "worldMemory">>
  ): Save | undefined | Promise<Save | undefined>;
  patchCharacter(
    saveId: string,
    characterId: string,
    patch: CharacterPatch
  ): Save | undefined | Promise<Save | undefined>;
  createCharacter(saveId: string, input: CreateCharacterInput): Save | undefined | Promise<Save | undefined>;
  deleteCharacter(saveId: string, characterId: string): Save | undefined | Promise<Save | undefined>;
  createLocation(saveId: string, input: CreateLocationInput): Save | undefined | Promise<Save | undefined>;
  patchLocation(saveId: string, locationId: string, patch: LocationPatch): Save | undefined | Promise<Save | undefined>;
  deleteLocation(saveId: string, locationId: string): Save | undefined | Promise<Save | undefined>;
  createRelationship(saveId: string, input: CreateRelationshipInput): Save | undefined | Promise<Save | undefined>;
  patchRelationship(
    saveId: string,
    relationshipId: string,
    patch: RelationshipPatch
  ): Save | undefined | Promise<Save | undefined>;
  deleteRelationship(saveId: string, relationshipId: string): Save | undefined | Promise<Save | undefined>;
  createTurnJob(
    saveId: string,
    input: CreateTurnInput,
    orchestration?: TurnOrchestrationOutput
  ): TurnJob | undefined | Promise<TurnJob | undefined>;
  getTurnJobByIdempotencyKey(
    saveId: string,
    idempotencyKey: string
  ): TurnJob | undefined | Promise<TurnJob | undefined>;
  getActiveTurnJob(saveId: string): TurnJob | undefined | Promise<TurnJob | undefined>;
  patchTurnDraft(jobId: string, input: PatchTurnDraftInput): TurnJob | undefined | Promise<TurnJob | undefined>;
  cancelTurnJob(jobId: string): TurnJob | undefined | Promise<TurnJob | undefined>;
  retryTurnJob(jobId: string): TurnJob | undefined | Promise<TurnJob | undefined>;
  acceptTurn(turnId: string): Save | undefined | Promise<Save | undefined>;
  rollbackSave(saveId: string): Save | undefined | Promise<Save | undefined>;
  getTurnJob(jobId: string): TurnJob | undefined | Promise<TurnJob | undefined>;
};
