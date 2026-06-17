import { Compile } from "typebox/compile";
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  SaveSchema,
  type Save,
  type SaveExport,
  type SaveImport
} from "@fantasy-world/shared";
import { now } from "./store/prototype-store.js";

type SaveMigration = (input: unknown) => Save | undefined;
type SaveImportResult =
  | {
      ok: true;
      save: Save;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

const saveValidator = Compile(SaveSchema);

export const saveImportMigrations: Record<string, SaveMigration | undefined> = {};

export function createSaveExport(save: Save): SaveExport {
  return {
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    exportedAt: now(),
    save
  };
}

export function normalizeSaveImport(input: SaveImport): SaveImportResult {
  const object = asObject(input);

  if (!object) {
    return invalidImport();
  }

  const schemaVersion = typeof object.schemaVersion === "string" ? object.schemaVersion : "";
  const candidate = "save" in object ? object.save : input;

  if (!schemaVersion) {
    return invalidImport();
  }

  if (schemaVersion !== CURRENT_SAVE_SCHEMA_VERSION) {
    const migration = saveImportMigrations[schemaVersion];

    if (!migration) {
      return {
        ok: false,
        code: "unsupported_schema_version",
        message: `Unsupported save schemaVersion: ${schemaVersion}`
      };
    }

    const migrated = migration(candidate);

    if (!migrated || !saveValidator.Check(migrated)) {
      return invalidImport();
    }

    return {
      ok: true,
      save: migrated
    };
  }

  if (!saveValidator.Check(candidate)) {
    return invalidImport();
  }

  return {
    ok: true,
    save: candidate
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function invalidImport(): SaveImportResult {
  return {
    ok: false,
    code: "invalid_save_import",
    message: "Import save payload is missing required fields or has invalid fields"
  };
}
