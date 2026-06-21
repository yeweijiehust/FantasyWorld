import { createTemplateSaveInput } from "@fantasy-world/shared";
import { describe, expect, it } from "vitest";
import { PrototypeStore } from "./prototype-store.js";

describe("PrototypeStore repository behavior", () => {
  it("keeps rollback snapshots and imported turn references consistent", () => {
    const store = new PrototypeStore();
    const generation = store.createGenerationJob(createTemplateSaveInput("fantasy-frontier", "zh"));
    const save = store.acceptGenerationJob(generation.id);

    if (!save) {
      throw new Error("save was not accepted");
    }

    const turnJob = store.createTurnJob(save.id, { idempotencyKey: "repo-turn" });

    if (!turnJob?.turn) {
      throw new Error("turn was not created");
    }

    const accepted = store.acceptTurn(turnJob.turn.id);

    if (!accepted) {
      throw new Error("turn was not accepted");
    }

    expect(accepted?.turnNumber).toBe(1);
    expect(accepted?.turns[0]?.saveId).toBe(save.id);

    const imported = store.importSave(accepted);

    expect(imported.turns[0]?.saveId).toBe(imported.id);

    const importedTurnJob = store.createTurnJob(imported.id, { idempotencyKey: "repo-imported-turn" });

    expect(importedTurnJob?.turn?.turnNumber).toBe(2);

    const rolledBack = store.rollbackSave(save.id);

    expect(rolledBack?.turnNumber).toBe(0);
    expect(rolledBack?.turns).toHaveLength(1);
    expect(rolledBack?.headTurnId).toBeUndefined();

    const branchTurnJob = store.createTurnJob(save.id, { idempotencyKey: "repo-branch-turn" });
    const branchAccepted = branchTurnJob?.turn ? store.acceptTurn(branchTurnJob.turn.id) : undefined;

    expect(branchAccepted?.turnNumber).toBe(1);
    expect(branchAccepted?.turns).toHaveLength(2);
    expect(branchAccepted?.turns[1]?.parentTurnId).toBeUndefined();
    expect(branchAccepted?.turns[1]?.branchId).not.toBe(branchAccepted?.turns[0]?.branchId);
  });

  it("removes relationships when a character is deleted", () => {
    const store = new PrototypeStore();
    const generation = store.createGenerationJob(createTemplateSaveInput("fantasy-frontier", "en"));
    const save = store.acceptGenerationJob(generation.id);
    const character = save?.characters[0];

    if (!save || !character) {
      throw new Error("character fixture missing");
    }

    expect(save.relationships.some((relationship) => relationship.sourceCharacterId === character.id)).toBe(true);

    const updated = store.deleteCharacter(save.id, character.id);

    expect(updated?.characters.some((item) => item.id === character.id)).toBe(false);
    expect(
      updated?.relationships.some(
        (relationship) =>
          relationship.sourceCharacterId === character.id || relationship.targetCharacterId === character.id
      )
    ).toBe(false);
  });
});
