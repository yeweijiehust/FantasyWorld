import type {
  CharacterPatch,
  CreateCharacterInput,
  CreateLocationInput,
  CreateRelationshipInput,
  CreateSaveInput,
  CreateTurnInput,
  GeneratedWorldDraft,
  JobFailure,
  LlmCallSummary,
  LocationPatch,
  ModelConfig,
  ModelConfigUpdate,
  PatchTurnDraftInput,
  RelationshipPatch,
  Save,
  SaveGenerationJob,
  SaveListItem,
  TurnOrchestrationOutput,
  TurnJob,
  User
} from "@fantasy-world/shared";

export type ModelCredentials = ModelConfig & {
  apiKey?: string;
};

export type ModelCredentialsScope = {
  saveId?: string;
  modelOverride?: Partial<
    Pick<
      ModelConfig,
      | "baseUrl"
      | "model"
      | "supportsJsonMode"
      | "supportsUsage"
      | "supportsStream"
      | "inputTokenPriceUsdPerMillion"
      | "outputTokenPriceUsdPerMillion"
    >
  >;
};

export type FantasyWorldStore = {
  getOrCreateUser(username: string): User | Promise<User>;
  createSession(userId?: string): string | Promise<string>;
  hasSession(sessionId: string | undefined): boolean | Promise<boolean>;
  getSessionUser(sessionId: string | undefined): User | undefined | Promise<User | undefined>;
  deleteSession(sessionId: string): void | Promise<void>;
  getModelConfig(): ModelConfig | Promise<ModelConfig>;
  getModelCredentials(scope?: ModelCredentialsScope): ModelCredentials | Promise<ModelCredentials>;
  updateModelConfig(input: ModelConfigUpdate): ModelConfig | Promise<ModelConfig>;
  getSaveModelConfig(saveId: string): ModelConfig | undefined | Promise<ModelConfig | undefined>;
  updateSaveModelConfig(saveId: string, input: ModelConfigUpdate): Save | undefined | Promise<Save | undefined>;
  clearSaveModelConfig(saveId: string): Save | undefined | Promise<Save | undefined>;
  listSaves(ownerUserId?: string): SaveListItem[] | Promise<SaveListItem[]>;
  getSave(saveId: string, ownerUserId?: string): Save | undefined | Promise<Save | undefined>;
  createQueuedGenerationJob(
    input: CreateSaveInput,
    ownerUserId?: string
  ): SaveGenerationJob | Promise<SaveGenerationJob>;
  createGenerationJob(
    input: CreateSaveInput,
    generatedDraft?: GeneratedWorldDraft,
    llmCall?: LlmCallSummary,
    ownerUserId?: string
  ): SaveGenerationJob | Promise<SaveGenerationJob>;
  createFailedGenerationJob(
    input: CreateSaveInput,
    failure: JobFailure,
    llmCall?: LlmCallSummary,
    ownerUserId?: string
  ): SaveGenerationJob | Promise<SaveGenerationJob>;
  getGenerationJobByIdempotencyKey(
    idempotencyKey: string,
    ownerUserId?: string
  ): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  getGenerationJob(
    jobId: string,
    ownerUserId?: string
  ): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  listActiveGenerationJobs(): SaveGenerationJob[] | Promise<SaveGenerationJob[]>;
  startGenerationJob(
    jobId: string,
    phase: string
  ): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  completeGenerationJob(
    jobId: string,
    generatedDraft: GeneratedWorldDraft,
    llmCall?: LlmCallSummary
  ): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  failGenerationJob(
    jobId: string,
    failure: JobFailure,
    llmCall?: LlmCallSummary
  ): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  cancelGenerationJob(jobId: string): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  retryGenerationJob(
    jobId: string,
    generatedDraft?: GeneratedWorldDraft,
    llmCall?: LlmCallSummary
  ): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  queueGenerationRetry(jobId: string): SaveGenerationJob | undefined | Promise<SaveGenerationJob | undefined>;
  acceptGenerationJob(jobId: string, ownerUserId?: string): Save | undefined | Promise<Save | undefined>;
  importSave(input: Save, ownerUserId?: string): Save | Promise<Save>;
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
    orchestration?: TurnOrchestrationOutput,
    llmCall?: LlmCallSummary
  ): TurnJob | undefined | Promise<TurnJob | undefined>;
  createQueuedTurnJob(saveId: string, input: CreateTurnInput): TurnJob | undefined | Promise<TurnJob | undefined>;
  createFailedTurnJob(
    saveId: string,
    input: CreateTurnInput,
    failure: JobFailure,
    llmCall?: LlmCallSummary
  ): TurnJob | undefined | Promise<TurnJob | undefined>;
  getTurnJobByIdempotencyKey(
    saveId: string,
    idempotencyKey: string,
    ownerUserId?: string
  ): TurnJob | undefined | Promise<TurnJob | undefined>;
  getActiveTurnJob(saveId: string): TurnJob | undefined | Promise<TurnJob | undefined>;
  listActiveTurnJobs(): TurnJob[] | Promise<TurnJob[]>;
  startTurnJob(jobId: string, phase: string): TurnJob | undefined | Promise<TurnJob | undefined>;
  completeTurnJob(
    jobId: string,
    orchestration: TurnOrchestrationOutput,
    llmCall?: LlmCallSummary
  ): TurnJob | undefined | Promise<TurnJob | undefined>;
  failTurnJob(
    jobId: string,
    failure: JobFailure,
    llmCall?: LlmCallSummary
  ): TurnJob | undefined | Promise<TurnJob | undefined>;
  patchTurnDraft(jobId: string, input: PatchTurnDraftInput): TurnJob | undefined | Promise<TurnJob | undefined>;
  cancelTurnJob(jobId: string): TurnJob | undefined | Promise<TurnJob | undefined>;
  retryTurnJob(
    jobId: string,
    orchestration?: TurnOrchestrationOutput,
    llmCall?: LlmCallSummary
  ): TurnJob | undefined | Promise<TurnJob | undefined>;
  queueTurnRetry(jobId: string): TurnJob | undefined | Promise<TurnJob | undefined>;
  acceptTurn(turnId: string, ownerUserId?: string): Save | undefined | Promise<Save | undefined>;
  rollbackSave(saveId: string): Save | undefined | Promise<Save | undefined>;
  getTurnJob(jobId: string, ownerUserId?: string): TurnJob | undefined | Promise<TurnJob | undefined>;
};
