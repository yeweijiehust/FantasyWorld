import { describe, expect, it } from "vitest";
import { Compile } from "typebox/compile";
import { CreateSaveInputSchema, SaveExportSchema, SaveSchema } from "./schemas.js";
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
