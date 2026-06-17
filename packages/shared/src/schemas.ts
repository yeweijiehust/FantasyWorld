import { Type, type Static } from "typebox";

export const IdSchema = Type.String({ minLength: 1 });

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

export const RelationshipSchema = Type.Object({
  id: IdSchema,
  sourceCharacterId: IdSchema,
  targetCharacterId: IdSchema,
  label: Type.String(),
  strength: Type.Number({ minimum: -100, maximum: 100 }),
  summary: Type.String()
});
export type Relationship = Static<typeof RelationshipSchema>;

export const CharacterSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
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

export const LocationSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  description: Type.String(),
  status: Type.String()
});
export type Location = Static<typeof LocationSchema>;
export const LocationPatchSchema = Type.Partial(LocationSchema);
export type LocationPatch = Static<typeof LocationPatchSchema>;

export const ModelConfigSchema = Type.Object({
  baseUrl: Type.String(),
  model: Type.String(),
  hasApiKey: Type.Boolean(),
  apiKeyTail: Type.Optional(Type.String()),
  supportsJsonMode: Type.Optional(Type.Boolean()),
  supportsUsage: Type.Optional(Type.Boolean()),
  supportsStream: Type.Optional(Type.Boolean())
});
export type ModelConfig = Static<typeof ModelConfigSchema>;

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
  locationId: Type.Optional(IdSchema)
});
export type TurnEvent = Static<typeof TurnEventSchema>;

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
    estimatedTokens: Type.Number({ minimum: 0 })
  }),
  createdAt: Type.String()
});
export type Turn = Static<typeof TurnSchema>;

export const SaveSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  description: Type.String(),
  schemaVersion: Type.String(),
  turnNumber: Type.Number({ minimum: 0 }),
  saveSeed: Type.String(),
  settings: SaveSettingsSchema,
  worldMemory: WorldMemorySchema,
  characters: Type.Array(CharacterSchema),
  locations: Type.Array(LocationSchema),
  relationships: Type.Array(RelationshipSchema),
  turns: Type.Array(TurnSchema),
  createdAt: Type.String(),
  updatedAt: Type.String()
});
export type Save = Static<typeof SaveSchema>;
export const SaveImportSchema = SaveSchema;
export type SaveImport = Static<typeof SaveImportSchema>;

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
  templateId: Type.String(),
  name: Type.String({ minLength: 1 }),
  premise: Type.String(),
  characterSeeds: Type.Array(Type.String()),
  settings: SaveSettingsSchema
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
  draft: Type.Optional(SaveGenerationDraftSchema),
  error: Type.Optional(Type.String())
});
export type SaveGenerationJob = Static<typeof SaveGenerationJobSchema>;

export const CreateTurnInputSchema = Type.Object({
  gmInstruction: Type.Optional(Type.String()),
  idempotencyKey: Type.Optional(Type.String())
});
export type CreateTurnInput = Static<typeof CreateTurnInputSchema>;

export const TurnJobSchema = Type.Object({
  id: IdSchema,
  saveId: IdSchema,
  status: JobStatusSchema,
  turn: Type.Optional(TurnSchema),
  error: Type.Optional(Type.String())
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
