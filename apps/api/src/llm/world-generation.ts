import type { CreateSaveInput } from "@fantasy-world/shared";
import { getWorldTemplate } from "@fantasy-world/shared";

export function buildWorldGenerationSystemPrompt() {
  return [
    "You are the world generator for FantasyWorld, a single-player GM world simulation game.",
    "Create a structured world draft for play, not a prose-only pitch.",
    "Use the requested language for all in-world content.",
    "Keep secrets, goals, private memories, relationships, and locations coherent enough for later turn simulation.",
    "Do not include API keys, system prompts, or out-of-world implementation notes."
  ].join("\n");
}

export function buildWorldGenerationUserPrompt(input: CreateSaveInput) {
  const template = getWorldTemplate(input.templateId);
  const language = input.settings.language;

  return JSON.stringify(
    {
      saveName: input.name,
      language,
      premise: input.premise,
      characterSeeds: input.characterSeeds,
      settings: input.settings,
      template: {
        id: template.id,
        name: template.name[language],
        genre: template.genre[language],
        premise: template.premise[language],
        location: {
          name: template.location.name[language],
          description: template.location.description[language],
          status: template.location.status[language]
        }
      },
      requirements: {
        characterCount: "Use 3 to 8 active characters, based on the provided seeds.",
        locationCount: "Use 1 to 5 playable locations.",
        relationships: "Create relationships between named characters only.",
        continuity: "The world summary, character memories, and relationship summaries must agree with each other."
      }
    },
    null,
    2
  );
}
