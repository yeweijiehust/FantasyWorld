import { isNotNull, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as dbSchema from "../db/schema.js";
import { isValidEncryptionKey, rotateEncryptedSecret } from "./secrets.js";

type Database = NodePgDatabase<typeof dbSchema>;

export type EncryptionKeyRotationInput = {
  oldKey: string;
  newKey: string;
  dryRun?: boolean;
};

export type EncryptionKeyRotationResult = {
  dryRun: boolean;
  modelConfigs: number;
  saves: number;
  updated: number;
  modelConfigIds: string[];
  saveIds: string[];
};

export async function rotateDatabaseEncryptionKey(
  db: Database,
  input: EncryptionKeyRotationInput
): Promise<EncryptionKeyRotationResult> {
  const oldKey = input.oldKey.trim();
  const newKey = input.newKey.trim();

  if (!oldKey) {
    throw new Error("OLD_ENCRYPTION_KEY or --old-key is required");
  }

  if (!isValidEncryptionKey(newKey)) {
    throw new Error("NEW_ENCRYPTION_KEY or --new-key must be a 32-byte base64 value");
  }

  if (oldKey === newKey) {
    throw new Error("Old and new encryption keys must be different");
  }

  return await db.transaction(async (tx) => {
    const modelRows = await tx
      .select({
        id: dbSchema.modelConfigs.id,
        ciphertext: dbSchema.modelConfigs.apiKeyCiphertext
      })
      .from(dbSchema.modelConfigs)
      .where(isNotNull(dbSchema.modelConfigs.apiKeyCiphertext));
    const saveRows = await tx
      .select({
        id: dbSchema.saves.id,
        ciphertext: dbSchema.saves.modelApiKeyCiphertext
      })
      .from(dbSchema.saves)
      .where(isNotNull(dbSchema.saves.modelApiKeyCiphertext));
    const rotatedModelRows = modelRows.map((row) => ({
      id: row.id,
      ciphertext: rotateEncryptedSecret(row.ciphertext ?? "", oldKey, newKey)
    }));
    const rotatedSaveRows = saveRows.map((row) => ({
      id: row.id,
      ciphertext: rotateEncryptedSecret(row.ciphertext ?? "", oldKey, newKey)
    }));

    if (!input.dryRun) {
      for (const row of rotatedModelRows) {
        await tx
          .update(dbSchema.modelConfigs)
          .set({ apiKeyCiphertext: row.ciphertext, updatedAt: new Date() })
          .where(eq(dbSchema.modelConfigs.id, row.id));
      }

      for (const row of rotatedSaveRows) {
        await tx
          .update(dbSchema.saves)
          .set({ modelApiKeyCiphertext: row.ciphertext, updatedAt: new Date() })
          .where(eq(dbSchema.saves.id, row.id));
      }
    }

    return {
      dryRun: Boolean(input.dryRun),
      modelConfigs: rotatedModelRows.length,
      saves: rotatedSaveRows.length,
      updated: input.dryRun ? 0 : rotatedModelRows.length + rotatedSaveRows.length,
      modelConfigIds: rotatedModelRows.map((row) => row.id),
      saveIds: rotatedSaveRows.map((row) => row.id)
    };
  });
}
