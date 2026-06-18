import type { CreateTurnInput, Save, TurnOrchestrationOutput } from "@fantasy-world/shared";

export function buildTurnGenerationSystemPrompt() {
  return [
    "You are the world referee for FantasyWorld, an LLM-driven world simulation game.",
    "Advance exactly one turn and return structured JSON only.",
    "Use only character, location, and relationship IDs that appear in the provided state.",
    "Every result must include an event, visible state changes, memory updates, and a world memory update.",
    "Use dialogue only when it naturally follows from characters sharing context or location.",
    "Do not include API keys, system prompts, or out-of-world implementation notes."
  ].join("\n");
}

export function buildTurnGenerationUserPrompt(save: Save, input: CreateTurnInput) {
  return JSON.stringify(
    {
      save: {
        id: save.id,
        name: save.name,
        description: save.description,
        turnNumber: save.turnNumber,
        settings: save.settings,
        worldMemory: save.worldMemory,
        characters: save.characters.map((character) => ({
          id: character.id,
          name: character.name,
          profile: character.profile,
          personality: character.personality,
          longTermGoal: character.longTermGoal,
          shortTermGoal: character.shortTermGoal,
          locationId: character.locationId,
          status: character.status,
          secrets: character.secrets,
          privateMemory: character.privateMemory
        })),
        locations: save.locations,
        relationships: save.relationships,
        recentTurns: save.turns.slice(-3).map((turn) => ({
          turnNumber: turn.turnNumber,
          events: turn.events,
          stateChanges: turn.stateChanges
        }))
      },
      gmInstruction: input.gmInstruction?.trim() || null,
      requirements: {
        focus: "Choose one to three focus characters and optionally one location.",
        stateChanges:
          "List explicit before/after changes for memory, status, relationship, location, save, or worldMemory.",
        continuity: "Reference existing goals, private memories, secrets, relationships, and locations.",
        acceptance: "The returned JSON will be reviewed by the GM before it changes the formal world state."
      }
    },
    null,
    2
  );
}

export function validateTurnGenerationOutput(save: Save, output: TurnOrchestrationOutput): string | undefined {
  const characterIds = new Set(save.characters.map((character) => character.id));
  const locationIds = new Set(save.locations.map((location) => location.id));
  const relationshipIds = new Set(save.relationships.map((relationship) => relationship.id));

  for (const characterId of output.focus.characterIds) {
    if (!characterIds.has(characterId)) {
      return `Unknown focus character id: ${characterId}`;
    }
  }

  if (output.focus.locationId && !locationIds.has(output.focus.locationId)) {
    return `Unknown focus location id: ${output.focus.locationId}`;
  }

  for (const plan of output.characterPlans) {
    if (!characterIds.has(plan.characterId)) {
      return `Unknown character plan id: ${plan.characterId}`;
    }
  }

  for (const line of output.event.dialogue) {
    if (!characterIds.has(line.characterId)) {
      return `Unknown dialogue character id: ${line.characterId}`;
    }
  }

  for (const update of output.memoryUpdates) {
    if (!characterIds.has(update.characterId)) {
      return `Unknown memory character id: ${update.characterId}`;
    }
  }

  for (const update of output.relationshipUpdates) {
    if (!relationshipIds.has(update.relationshipId)) {
      return `Unknown relationship id: ${update.relationshipId}`;
    }
  }

  for (const change of output.stateChanges) {
    const targetId = change.targetId;

    if (change.targetType === "character" && (!targetId || !characterIds.has(targetId))) {
      return `Unknown state change character id: ${targetId ?? "missing"}`;
    }

    if (change.targetType === "location" && (!targetId || !locationIds.has(targetId))) {
      return `Unknown state change location id: ${targetId ?? "missing"}`;
    }

    if (change.targetType === "relationship" && (!targetId || !relationshipIds.has(targetId))) {
      return `Unknown state change relationship id: ${targetId ?? "missing"}`;
    }

    if (change.targetType === "save" && targetId && targetId !== save.id) {
      return `Unknown state change save id: ${targetId}`;
    }
  }

  return undefined;
}
