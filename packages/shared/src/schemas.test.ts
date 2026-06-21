import { describe, expect, it } from "vitest";
import { Compile } from "typebox/compile";
import { CreateSaveInputSchema, GeneratedWorldDraftSchema, SaveExportSchema, SaveSchema } from "./schemas.js";
import { WORLD_TEMPLATES, createTemplateSaveInput } from "./templates.js";

describe("SaveSchema", () => {
  it("accepts a minimal generated save", () => {
    const check = Compile(SaveSchema);
    const save = {
      id: "save_1",
      name: "Test World",
      description: "A world",
      schemaVersion: "1",
      turnNumber: 0,
      saveSeed: "seed",
      settings: {
        language: "zh",
        turnTimeScale: "一幕",
        randomness: 25,
        contentBoundary: "PG-13",
        styleGuide: "稳健"
      },
      worldMemory: {
        timeline: [],
        worldSummary: "初始世界",
        locationSummaries: {}
      },
      characters: [],
      locations: [],
      relationships: [],
      turns: [],
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:00:00.000Z"
    };
    const valid = check.Check(save);

    expect(valid).toBe(true);
    expect(check.Check({ ...save, schemaVersion: "999" })).toBe(false);
    expect(
      Compile(SaveExportSchema).Check({
        schemaVersion: "1",
        exportedAt: "2026-06-16T01:00:00.000Z",
        save
      })
    ).toBe(true);
  });
});

describe("world templates", () => {
  it("provide template save input with 3 to 8 character seeds", () => {
    expect(WORLD_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(WORLD_TEMPLATES.length).toBeLessThanOrEqual(5);

    const check = Compile(CreateSaveInputSchema);
    const input = createTemplateSaveInput("arcane-academy", "en");

    expect(input.name).toBe("Star Lantern Archive");
    expect(input.characterSeeds.length).toBeGreaterThanOrEqual(3);
    expect(input.characterSeeds.length).toBeLessThanOrEqual(8);
    expect(check.Check(input)).toBe(true);
  });
});

describe("GeneratedWorldDraftSchema", () => {
  it("accepts the structured LLM world draft shape", () => {
    const check = Compile(GeneratedWorldDraftSchema);

    expect(
      check.Check({
        description: "A port city where omen bells predict disasters.",
        worldSummary: "The city is split over who controls prophetic machinery.",
        locations: [
          {
            name: "Clockwork Harbor",
            description: "A brass-and-tide port full of omen bells.",
            status: "The bells are ringing early."
          }
        ],
        characters: ["Ada", "Bryn", "Cato"].map((name) => ({
          name,
          profile: `${name} is tied to the harbor crisis.`,
          personality: "Driven and secretive",
          longTermGoal: "Protect the harbor",
          shortTermGoal: "Find the next clue",
          locationName: "Clockwork Harbor",
          status: "Available",
          secrets: ["Knows one hidden clue"],
          privateMemory: ["Remembers the bells ringing"]
        })),
        relationships: [
          {
            sourceCharacterName: "Ada",
            targetCharacterName: "Bryn",
            label: "Uneasy allies",
            strength: 42,
            summary: "They need each other but trade secrets carefully."
          }
        ]
      })
    ).toBe(true);

    expect(
      check.Check({
        description: "Too small",
        worldSummary: "No cast",
        locations: [],
        characters: [],
        relationships: []
      })
    ).toBe(false);
  });
});
