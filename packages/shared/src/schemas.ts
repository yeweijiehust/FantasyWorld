import { Type, type Static } from "typebox";

export const IdSchema = Type.String({ minLength: 1 });
export const NonEmptyStringSchema = Type.String({ minLength: 1 });
export const CURRENT_SAVE_SCHEMA_VERSION = "1";

export const LanguageSchema = Type.Union([Type.Literal("zh"), Type.Literal("en")]);
export type Language = Static<typeof LanguageSchema>;

export const JobStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("needs_review"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("accepted")
]);
export type JobStatus = Static<typeof JobStatusSchema>;

export const JobFailureSchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
  phase: Type.String({ minLength: 1 }),
  retryable: Type.Boolean(),
  createdAt: Type.String(),
  provider: Type.Optional(Type.String({ minLength: 1 })),
  rawOutputSummary: Type.Optional(Type.String({ minLength: 1 }))
});
export type JobFailure = Static<typeof JobFailureSchema>;

export const RelationshipSchema = Type.Object({
  id: IdSchema,
  sourceCharacterId: IdSchema,
  targetCharacterId: IdSchema,
  label: NonEmptyStringSchema,
  strength: Type.Number({ minimum: -100, maximum: 100 }),
  summary: Type.String()
});
export type Relationship = Static<typeof RelationshipSchema>;
export const RelationshipPatchSchema = Type.Partial(RelationshipSchema);
export type RelationshipPatch = Static<typeof RelationshipPatchSchema>;
export const CreateRelationshipInputSchema = Type.Object({
  sourceCharacterId: IdSchema,
  targetCharacterId: IdSchema,
  label: NonEmptyStringSchema,
  strength: Type.Number({ minimum: -100, maximum: 100 }),
  summary: Type.String()
});
export type CreateRelationshipInput = Static<typeof CreateRelationshipInputSchema>;

export const CharacterSchema = Type.Object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  profile: Type.String(),
  personality: Type.String(),
  longTermGoal: Type.String(),
  shortTermGoal: Type.String(),
  locationId: IdSchema,
  status: Type.String(),
  secrets: Type.Array(Type.String()),
  privateMemory: Type.Array(Type.String())
});
export type Character = Static<typeof CharacterSchema>;
export const CharacterPatchSchema = Type.Partial(CharacterSchema);
export type CharacterPatch = Static<typeof CharacterPatchSchema>;
export const CreateCharacterInputSchema = Type.Object({
  name: NonEmptyStringSchema,
  profile: Type.String(),
  personality: Type.String(),
  longTermGoal: Type.String(),
  shortTermGoal: Type.String(),
  locationId: IdSchema,
  status: Type.String(),
  secrets: Type.Array(Type.String()),
  privateMemory: Type.Array(Type.String())
});
export type CreateCharacterInput = Static<typeof CreateCharacterInputSchema>;

export const LocationSchema = Type.Object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  description: Type.String(),
  status: Type.String()
});
export type Location = Static<typeof LocationSchema>;
export const LocationPatchSchema = Type.Partial(LocationSchema);
export type LocationPatch = Static<typeof LocationPatchSchema>;
export const CreateLocationInputSchema = Type.Object({
  name: NonEmptyStringSchema,
  description: Type.String(),
  status: Type.String()
});
export type CreateLocationInput = Static<typeof CreateLocationInputSchema>;

export const ModelConfigSchema = Type.Object({
  baseUrl: Type.String(),
  model: Type.String(),
  hasApiKey: Type.Boolean(),
  apiKeyTail: Type.Optional(Type.String()),
  supportsJsonMode: Type.Optional(Type.Boolean()),
  supportsUsage: Type.Optional(Type.Boolean()),
  supportsStream: Type.Optional(Type.Boolean()),
  inputTokenPriceUsdPerMillion: Type.Optional(Type.Number({ minimum: 0 })),
  outputTokenPriceUsdPerMillion: Type.Optional(Type.Number({ minimum: 0 }))
});
export type ModelConfig = Static<typeof ModelConfigSchema>;

export const ModelConfigUpdateSchema = Type.Partial(
  Type.Object({
    baseUrl: Type.String(),
    model: Type.String(),
    apiKey: Type.String(),
    supportsJsonMode: Type.Boolean(),
    supportsUsage: Type.Boolean(),
    supportsStream: Type.Boolean(),
    inputTokenPriceUsdPerMillion: Type.Number({ minimum: 0 }),
    outputTokenPriceUsdPerMillion: Type.Number({ minimum: 0 })
  })
);
export type ModelConfigUpdate = Static<typeof ModelConfigUpdateSchema>;

export const LlmCallSummarySchema = Type.Object({
  provider: Type.Union([Type.Literal("mock"), Type.Literal("openai-compatible")]),
  model: Type.String(),
  status: Type.Union([Type.Literal("succeeded"), Type.Literal("failed")]),
  latencyMs: Type.Number({ minimum: 0 }),
  estimatedTokens: Type.Number({ minimum: 0 }),
  inputTokens: Type.Optional(Type.Number({ minimum: 0 })),
  outputTokens: Type.Optional(Type.Number({ minimum: 0 })),
  totalTokens: Type.Optional(Type.Number({ minimum: 0 })),
  estimatedUsage: Type.Optional(Type.Boolean()),
  estimatedCostUsd: Type.Optional(Type.Number({ minimum: 0 })),
  inputTokenPriceUsdPerMillion: Type.Optional(Type.Number({ minimum: 0 })),
  outputTokenPriceUsdPerMillion: Type.Optional(Type.Number({ minimum: 0 }))
});
export type LlmCallSummary = Static<typeof LlmCallSummarySchema>;

export const ModelProbeInputSchema = Type.Partial(
  Type.Object({
    baseUrl: Type.String(),
    model: Type.String(),
    apiKey: Type.String()
  })
);
export type ModelProbeInput = Static<typeof ModelProbeInputSchema>;

export const ModelProbeResultSchema = Type.Object({
  ok: Type.Boolean(),
  provider: Type.Union([Type.Literal("mock"), Type.Literal("openai-compatible")]),
  config: ModelConfigSchema,
  latencyMs: Type.Number({ minimum: 0 }),
  error: Type.Optional(
    Type.Object({
      code: Type.String(),
      message: Type.String()
    })
  )
});
export type ModelProbeResult = Static<typeof ModelProbeResultSchema>;

export const SaveSettingsSchema = Type.Object({
  language: LanguageSchema,
  turnTimeScale: Type.String(),
  randomness: Type.Number({ minimum: 0, maximum: 100 }),
  contentBoundary: Type.String(),
  styleGuide: Type.String()
});
export type SaveSettings = Static<typeof SaveSettingsSchema>;

export const WorldMemorySchema = Type.Object({
  timeline: Type.Array(Type.String()),
  worldSummary: Type.String(),
  locationSummaries: Type.Record(Type.String(), Type.String())
});
export type WorldMemory = Static<typeof WorldMemorySchema>;

export const StateChangeSchema = Type.Object({
  id: IdSchema,
  targetType: Type.Union([
    Type.Literal("save"),
    Type.Literal("character"),
    Type.Literal("location"),
    Type.Literal("relationship"),
    Type.Literal("worldMemory")
  ]),
  targetId: Type.Optional(IdSchema),
  field: Type.String(),
  before: Type.String(),
  after: Type.String()
});
export type StateChange = Static<typeof StateChangeSchema>;

export const TurnEventSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  body: Type.String(),
  involvedCharacterIds: Type.Array(IdSchema),
  locationId: Type.Optional(IdSchema),
  dialogue: Type.Optional(
    Type.Array(
      Type.Object({
        characterId: IdSchema,
        line: Type.String({ minLength: 1 })
      })
    )
  )
});
export type TurnEvent = Static<typeof TurnEventSchema>;

export const TurnOrchestrationStateChangeSchema = Type.Object({
  targetType: Type.Union([
    Type.Literal("save"),
    Type.Literal("character"),
    Type.Literal("location"),
    Type.Literal("relationship"),
    Type.Literal("worldMemory")
  ]),
  targetId: Type.Optional(IdSchema),
  field: Type.String({ minLength: 1 }),
  before: Type.String(),
  after: Type.String()
});
export type TurnOrchestrationStateChange = Static<typeof TurnOrchestrationStateChangeSchema>;

export const TurnOrchestrationOutputSchema = Type.Object({
  focus: Type.Object({
    characterIds: Type.Array(IdSchema, { minItems: 1 }),
    locationId: Type.Optional(IdSchema),
    conflict: Type.String({ minLength: 1 }),
    gmInstruction: Type.Optional(Type.String({ minLength: 1 }))
  }),
  characterPlans: Type.Array(
    Type.Object({
      characterId: IdSchema,
      intention: Type.String({ minLength: 1 }),
      action: Type.String({ minLength: 1 }),
      referencedGoal: Type.String({ minLength: 1 }),
      referencedMemory: Type.Optional(Type.String({ minLength: 1 })),
      referencedSecret: Type.Optional(Type.String({ minLength: 1 })),
      relationshipContext: Type.Optional(Type.String({ minLength: 1 })),
      dialogue: Type.Optional(Type.String({ minLength: 1 }))
    }),
    { minItems: 1 }
  ),
  event: Type.Object({
    title: Type.String({ minLength: 1 }),
    body: Type.String({ minLength: 1 }),
    dialogue: Type.Array(
      Type.Object({
        characterId: IdSchema,
        line: Type.String({ minLength: 1 })
      })
    )
  }),
  stateChanges: Type.Array(TurnOrchestrationStateChangeSchema, { minItems: 1 }),
  memoryUpdates: Type.Array(
    Type.Object({
      characterId: IdSchema,
      entry: Type.String({ minLength: 1 })
    })
  ),
  relationshipUpdates: Type.Array(
    Type.Object({
      relationshipId: IdSchema,
      strengthDelta: Type.Number({ minimum: -20, maximum: 20 }),
      summary: Type.String({ minLength: 1 })
    })
  ),
  worldMemory: Type.Object({
    timelineEntry: Type.String({ minLength: 1 }),
    summaryDelta: Type.String({ minLength: 1 })
  })
});
export type TurnOrchestrationOutput = Static<typeof TurnOrchestrationOutputSchema>;

export const TurnSchema = Type.Object({
  id: IdSchema,
  saveId: IdSchema,
  turnNumber: Type.Number({ minimum: 1 }),
  status: JobStatusSchema,
  events: Type.Array(TurnEventSchema),
  stateChanges: Type.Array(StateChangeSchema),
  callSummary: Type.Object({
    model: Type.String(),
    calls: Type.Number({ minimum: 0 }),
    durationMs: Type.Number({ minimum: 0 }),
    estimatedTokens: Type.Number({ minimum: 0 }),
    provider: Type.Optional(Type.Union([Type.Literal("mock"), Type.Literal("openai-compatible")])),
    status: Type.Optional(Type.Union([Type.Literal("succeeded"), Type.Literal("failed")])),
    inputTokens: Type.Optional(Type.Number({ minimum: 0 })),
    outputTokens: Type.Optional(Type.Number({ minimum: 0 })),
    totalTokens: Type.Optional(Type.Number({ minimum: 0 })),
    estimatedUsage: Type.Optional(Type.Boolean()),
    estimatedCostUsd: Type.Optional(Type.Number({ minimum: 0 })),
    inputTokenPriceUsdPerMillion: Type.Optional(Type.Number({ minimum: 0 })),
    outputTokenPriceUsdPerMillion: Type.Optional(Type.Number({ minimum: 0 }))
  }),
  createdAt: Type.String()
});
export type Turn = Static<typeof TurnSchema>;

export const SaveSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  description: Type.String(),
  schemaVersion: Type.Literal(CURRENT_SAVE_SCHEMA_VERSION),
  turnNumber: Type.Number({ minimum: 0 }),
  saveSeed: Type.String(),
  settings: SaveSettingsSchema,
  modelConfig: Type.Optional(ModelConfigSchema),
  worldMemory: WorldMemorySchema,
  characters: Type.Array(CharacterSchema),
  locations: Type.Array(LocationSchema),
  relationships: Type.Array(RelationshipSchema),
  turns: Type.Array(TurnSchema),
  createdAt: Type.String(),
  updatedAt: Type.String()
});
export type Save = Static<typeof SaveSchema>;
export const SaveExportSchema = Type.Object({
  schemaVersion: Type.Literal(CURRENT_SAVE_SCHEMA_VERSION),
  exportedAt: Type.String(),
  save: SaveSchema
});
export type SaveExport = Static<typeof SaveExportSchema>;
export const SaveImportEnvelopeSchema = Type.Object({
  schemaVersion: Type.String({ minLength: 1 }),
  exportedAt: Type.Optional(Type.String()),
  save: Type.Unknown()
});
export const SaveImportSchema = Type.Union([
  SaveSchema,
  SaveImportEnvelopeSchema,
  Type.Object({ schemaVersion: Type.String({ minLength: 1 }) }, { additionalProperties: true })
]);
export type SaveImport = Static<typeof SaveImportSchema>;

export const GeneratedWorldDraftSchema = Type.Object({
  description: Type.String({ minLength: 1 }),
  worldSummary: Type.String({ minLength: 1 }),
  locations: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      description: Type.String({ minLength: 1 }),
      status: Type.String({ minLength: 1 })
    }),
    { minItems: 1, maxItems: 5 }
  ),
  characters: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      profile: Type.String({ minLength: 1 }),
      personality: Type.String({ minLength: 1 }),
      longTermGoal: Type.String({ minLength: 1 }),
      shortTermGoal: Type.String({ minLength: 1 }),
      locationName: Type.Optional(Type.String({ minLength: 1 })),
      status: Type.String({ minLength: 1 }),
      secrets: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 5 }),
      privateMemory: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 8 })
    }),
    { minItems: 3, maxItems: 8 }
  ),
  relationships: Type.Array(
    Type.Object({
      sourceCharacterName: Type.String({ minLength: 1 }),
      targetCharacterName: Type.String({ minLength: 1 }),
      label: Type.String({ minLength: 1 }),
      strength: Type.Number({ minimum: 0, maximum: 100 }),
      summary: Type.String({ minLength: 1 })
    }),
    { maxItems: 16 }
  )
});
export type GeneratedWorldDraft = Static<typeof GeneratedWorldDraftSchema>;

export const SaveListItemSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  description: Type.String(),
  language: LanguageSchema,
  turnNumber: Type.Number({ minimum: 0 }),
  characterCount: Type.Number({ minimum: 0 }),
  updatedAt: Type.String()
});
export type SaveListItem = Static<typeof SaveListItemSchema>;

export const CreateSaveInputSchema = Type.Object({
  templateId: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  premise: Type.String({ minLength: 1 }),
  characterSeeds: Type.Array(Type.String({ minLength: 1 }), { minItems: 3, maxItems: 8 }),
  settings: SaveSettingsSchema,
  idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
  modelOverride: Type.Optional(
    Type.Partial(
      Type.Object({
        baseUrl: Type.String({ minLength: 1 }),
        model: Type.String({ minLength: 1 })
      })
    )
  )
});
export type CreateSaveInput = Static<typeof CreateSaveInputSchema>;

export const SaveGenerationDraftSchema = Type.Object({
  id: IdSchema,
  input: CreateSaveInputSchema,
  save: SaveSchema,
  createdAt: Type.String()
});
export type SaveGenerationDraft = Static<typeof SaveGenerationDraftSchema>;

export const SaveGenerationJobSchema = Type.Object({
  id: IdSchema,
  status: JobStatusSchema,
  phase: Type.Optional(Type.String()),
  idempotencyKey: Type.Optional(Type.String()),
  input: Type.Optional(CreateSaveInputSchema),
  draft: Type.Optional(SaveGenerationDraftSchema),
  llmCall: Type.Optional(LlmCallSummarySchema),
  error: Type.Optional(Type.String()),
  failure: Type.Optional(JobFailureSchema)
});
export type SaveGenerationJob = Static<typeof SaveGenerationJobSchema>;

export const CreateTurnInputSchema = Type.Object({
  gmInstruction: Type.Optional(Type.String()),
  idempotencyKey: Type.Optional(Type.String())
});
export type CreateTurnInput = Static<typeof CreateTurnInputSchema>;

export const TurnDraftCharacterUpdateSchema = Type.Object({
  characterId: IdSchema,
  status: Type.Optional(Type.String()),
  longTermGoal: Type.Optional(Type.String()),
  shortTermGoal: Type.Optional(Type.String()),
  privateMemory: Type.Optional(Type.Array(Type.String()))
});
export type TurnDraftCharacterUpdate = Static<typeof TurnDraftCharacterUpdateSchema>;

export const TurnDraftRelationshipUpdateSchema = Type.Object({
  relationshipId: IdSchema,
  strength: Type.Optional(Type.Number({ minimum: -100, maximum: 100 })),
  summary: Type.Optional(Type.String())
});
export type TurnDraftRelationshipUpdate = Static<typeof TurnDraftRelationshipUpdateSchema>;

export const TurnDraftStateSchema = Type.Object({
  worldMemory: Type.Object({
    timelineEntry: Type.String({ minLength: 1 }),
    summaryDelta: Type.String({ minLength: 1 })
  }),
  characterUpdates: Type.Array(TurnDraftCharacterUpdateSchema),
  relationshipUpdates: Type.Array(TurnDraftRelationshipUpdateSchema)
});
export type TurnDraftState = Static<typeof TurnDraftStateSchema>;

export const PatchTurnDraftInputSchema = Type.Object({
  event: Type.Optional(
    Type.Object({
      title: Type.Optional(Type.String({ minLength: 1 })),
      body: Type.Optional(Type.String({ minLength: 1 }))
    })
  ),
  stateChanges: Type.Optional(Type.Array(StateChangeSchema, { minItems: 1 })),
  characterUpdates: Type.Optional(Type.Array(TurnDraftCharacterUpdateSchema)),
  relationshipUpdates: Type.Optional(Type.Array(TurnDraftRelationshipUpdateSchema))
});
export type PatchTurnDraftInput = Static<typeof PatchTurnDraftInputSchema>;

export const TurnJobSchema = Type.Object({
  id: IdSchema,
  saveId: IdSchema,
  status: JobStatusSchema,
  phase: Type.Optional(Type.String()),
  idempotencyKey: Type.Optional(Type.String()),
  input: Type.Optional(CreateTurnInputSchema),
  turn: Type.Optional(TurnSchema),
  draftState: Type.Optional(TurnDraftStateSchema),
  llmCall: Type.Optional(LlmCallSummarySchema),
  error: Type.Optional(Type.String()),
  failure: Type.Optional(JobFailureSchema)
});
export type TurnJob = Static<typeof TurnJobSchema>;

export const ApiErrorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String()
  })
});
export type ApiError = Static<typeof ApiErrorSchema>;

export const SessionSchema = Type.Object({
  authenticated: Type.Boolean()
});
export type Session = Static<typeof SessionSchema>;
