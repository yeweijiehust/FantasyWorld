import { Compile } from "typebox/compile";
import type {
  Character,
  CreateTurnInput,
  Relationship,
  Save,
  TurnOrchestrationOutput,
  TurnOrchestrationStateChange
} from "@fantasy-world/shared";
import { TurnOrchestrationOutputSchema } from "@fantasy-world/shared";

const orchestrationCheck = Compile(TurnOrchestrationOutputSchema);

export function createTurnOrchestration(save: Save, input: CreateTurnInput, maxAttempts = 2): TurnOrchestrationOutput {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = buildMockOrchestration(save, input, attempt);

    if (orchestrationCheck.Check(candidate)) {
      return candidate;
    }
  }

  const errors = [...orchestrationCheck.Errors(buildMockOrchestration(save, input, maxAttempts))];
  const firstError = errors[0];
  throw new Error(firstError ? `Turn orchestration schema failed: ${firstError.message}` : "Turn orchestration failed");
}

function buildMockOrchestration(save: Save, input: CreateTurnInput, attempt: number): TurnOrchestrationOutput {
  const language = save.settings.language;
  const location = save.locations[save.turnNumber % Math.max(1, save.locations.length)];
  const focusCharacters = selectFocusCharacters(save);
  const instruction = input.gmInstruction?.trim();
  const conflict =
    instruction ||
    (language === "zh"
      ? "角色目标与地点压力开始互相牵动"
      : "Character goals begin pressing against the location's tension");
  const characterPlans = focusCharacters.map((character, index) => {
    const relationship = findRelationship(save.relationships, character.id, focusCharacters, index);
    const memory = character.privateMemory.at(-1);
    const secret = character.secrets[0];
    const relationshipContext = relationship
      ? language === "zh"
        ? `${relationship.label} ${relationship.strength}：${relationship.summary}`
        : `${relationship.label} ${relationship.strength}: ${relationship.summary}`
      : undefined;
    const referencedGoal = character.shortTermGoal || character.longTermGoal;
    const intention =
      language === "zh"
        ? `${character.name}围绕目标“${referencedGoal}”判断局势。`
        : `${character.name} judges the situation through the goal "${referencedGoal}."`;
    const action =
      language === "zh"
        ? `${character.name}在${location?.name ?? save.name}采取行动，并把${memory ?? "最初的记忆"}和秘密线索纳入判断。`
        : `${character.name} acts at ${location?.name ?? save.name}, weighing ${memory ?? "their first memory"} and a private lead.`;
    const dialogue =
      language === "zh"
        ? `${character.name}说：“我会按${referencedGoal}来处理，但不会忘记${memory ?? secret ?? "手里的线索"}。”`
        : `${character.name} says, "I will follow ${referencedGoal}, but I will not ignore ${memory ?? secret ?? "the lead I hold"}."`;

    const plan: TurnOrchestrationOutput["characterPlans"][number] = {
      characterId: character.id,
      intention,
      action,
      referencedGoal,
      dialogue
    };

    if (memory) {
      plan.referencedMemory = memory;
    }

    if (secret) {
      plan.referencedSecret = secret;
    }

    if (relationshipContext) {
      plan.relationshipContext = relationshipContext;
    }

    return plan;
  });
  const memoryUpdates = focusCharacters.map((character) => ({
    characterId: character.id,
    entry:
      language === "zh"
        ? `第 ${save.turnNumber + 1} 回合：${character.name}围绕“${conflict}”行动，并重新评估自己的目标。`
        : `Turn ${save.turnNumber + 1}: ${character.name} acted around "${conflict}" and reassessed their goal.`
  }));
  const relationshipUpdates = save.relationships
    .filter((relationship) =>
      focusCharacters.some(
        (character) =>
          character.id === relationship.sourceCharacterId || character.id === relationship.targetCharacterId
      )
    )
    .slice(0, 2)
    .map((relationship) => ({
      relationshipId: relationship.id,
      strengthDelta: instruction ? 5 : 2,
      summary:
        language === "zh"
          ? `${relationship.summary} 本回合因“${conflict}”出现新的试探。`
          : `${relationship.summary} This turn adds new pressure from "${conflict}."`
    }));
  const dialogue = characterPlans
    .filter((plan) => plan.dialogue)
    .map((plan) => ({
      characterId: plan.characterId,
      line: plan.dialogue ?? ""
    }));
  const title = instruction
    ? language === "zh"
      ? "GM 指令改变了局势"
      : "The GM directive changes the situation"
    : language === "zh"
      ? "世界裁判推进了局势"
      : "The world referee advances the situation";
  const body = buildEventBody(save, focusCharacters, location?.name ?? save.name, conflict, characterPlans, attempt);
  const stateChanges = buildStateChanges(save, focusCharacters, memoryUpdates, relationshipUpdates, conflict);
  const focus: TurnOrchestrationOutput["focus"] = {
    characterIds: focusCharacters.map((character) => character.id),
    conflict
  };

  if (location?.id) {
    focus.locationId = location.id;
  }

  if (instruction) {
    focus.gmInstruction = instruction;
  }

  return {
    focus,
    characterPlans,
    event: {
      title,
      body,
      dialogue
    },
    stateChanges,
    memoryUpdates,
    relationshipUpdates,
    worldMemory: {
      timelineEntry: `${save.turnNumber + 1}. ${title}: ${body}`,
      summaryDelta:
        language === "zh"
          ? `第 ${save.turnNumber + 1} 回合围绕“${conflict}”推进，焦点角色的目标、记忆和关系都被纳入结算。`
          : `Turn ${save.turnNumber + 1} advances around "${conflict}", resolving focus goals, memories, and relationships.`
    }
  };
}

function selectFocusCharacters(save: Save) {
  if (save.characters.length <= 2) {
    return save.characters;
  }

  const start = save.turnNumber % save.characters.length;
  const first = save.characters[start];
  const second = save.characters[(start + 1) % save.characters.length];

  return [first, second].filter(Boolean) as Character[];
}

function findRelationship(
  relationships: Relationship[],
  characterId: string,
  focusCharacters: Character[],
  index: number
) {
  const other = focusCharacters[(index + 1) % focusCharacters.length];

  if (!other) {
    return undefined;
  }

  return relationships.find(
    (relationship) =>
      (relationship.sourceCharacterId === characterId && relationship.targetCharacterId === other.id) ||
      (relationship.sourceCharacterId === other.id && relationship.targetCharacterId === characterId)
  );
}

function buildEventBody(
  save: Save,
  focusCharacters: Character[],
  place: string,
  conflict: string,
  plans: TurnOrchestrationOutput["characterPlans"],
  attempt: number
) {
  if (save.settings.language === "en") {
    const planText = plans
      .map((plan) => `${characterName(focusCharacters, plan.characterId)} intends to ${plan.action}`)
      .join(" ");

    return `At ${place}, the conflict "${conflict}" forces the focus cast to act. ${planText} Goals, private memories, secrets, and relationships shape the result.`;
  }

  const planText = plans
    .map((plan) => `${characterName(focusCharacters, plan.characterId)}的行动：${plan.action}`)
    .join(" ");
  const retryNote = attempt > 0 ? " 这次推演来自校验重试后的稳定结果。" : "";

  return `在${place}，“${conflict}”迫使焦点角色行动。${planText} 角色目标、私有记忆、秘密和关系共同影响了结算。${retryNote}`;
}

function buildStateChanges(
  save: Save,
  focusCharacters: Character[],
  memoryUpdates: TurnOrchestrationOutput["memoryUpdates"],
  relationshipUpdates: TurnOrchestrationOutput["relationshipUpdates"],
  conflict: string
): TurnOrchestrationStateChange[] {
  const changes: TurnOrchestrationStateChange[] = [
    {
      targetType: "worldMemory",
      field: "timeline",
      before: `${save.worldMemory.timeline.length} entries`,
      after: `${save.worldMemory.timeline.length + 1} entries`
    }
  ];

  for (const update of memoryUpdates) {
    const character = focusCharacters.find((item) => item.id === update.characterId);

    if (character) {
      changes.push({
        targetType: "character",
        targetId: character.id,
        field: "privateMemory",
        before: `${character.privateMemory.length} entries`,
        after: `${character.privateMemory.length + 1} entries`
      });
      changes.push({
        targetType: "character",
        targetId: character.id,
        field: "status",
        before: character.status,
        after: save.settings.language === "zh" ? `卷入：${conflict}` : `Engaged: ${conflict}`
      });
    }
  }

  for (const update of relationshipUpdates) {
    const relationship = save.relationships.find((item) => item.id === update.relationshipId);

    if (relationship) {
      changes.push({
        targetType: "relationship",
        targetId: relationship.id,
        field: "strength",
        before: String(relationship.strength),
        after: String(clampRelationshipStrength(relationship.strength + update.strengthDelta))
      });
      changes.push({
        targetType: "relationship",
        targetId: relationship.id,
        field: "summary",
        before: relationship.summary,
        after: update.summary
      });
    }
  }

  return changes;
}

function characterName(characters: Character[], characterId: string) {
  return characters.find((character) => character.id === characterId)?.name ?? characterId;
}

export function clampRelationshipStrength(value: number) {
  return Math.max(-100, Math.min(100, value));
}
