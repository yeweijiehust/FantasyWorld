import { describe, expect, it } from "vitest";
import { Compile } from "typebox/compile";
import { SaveSchema } from "./schemas.js";

describe("SaveSchema", () => {
  it("accepts a minimal generated save", () => {
    const check = Compile(SaveSchema);
    const valid = check.Check({
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
    });

    expect(valid).toBe(true);
  });
});
