import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as dbSchema from "../src/db/schema.js";
import { rotateDatabaseEncryptionKey } from "../src/security/key-rotation.js";

const { Pool } = pg;

type Args = {
  databaseUrl?: string;
  oldKey?: string;
  newKey?: string;
  dryRun: boolean;
  help: boolean;
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(usage());
  process.exit(0);
}

const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL;
const oldKey = args.oldKey ?? process.env.OLD_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY;
const newKey = args.newKey ?? process.env.NEW_ENCRYPTION_KEY;

if (!databaseUrl || !oldKey || !newKey) {
  console.error(usage());
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema: dbSchema });

try {
  const result = await rotateDatabaseEncryptionKey(db, {
    oldKey,
    newKey,
    dryRun: args.dryRun
  });

  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}

function parseArgs(values: string[]): Args {
  const args: Args = { dryRun: false, help: false };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }

    if (value === "--database-url") {
      args.databaseUrl = requiredOptionValue(value, values[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--old-key") {
      args.oldKey = requiredOptionValue(value, values[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--new-key") {
      args.newKey = requiredOptionValue(value, values[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${value ?? ""}`);
  }

  return args;
}

function requiredOptionValue(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function usage() {
  return [
    "Usage: pnpm keys:rotate -- --dry-run --database-url <DATABASE_URL> --old-key <OLD_ENCRYPTION_KEY> --new-key <NEW_ENCRYPTION_KEY>",
    "",
    "Environment fallback:",
    "  DATABASE_URL, OLD_ENCRYPTION_KEY or ENCRYPTION_KEY, NEW_ENCRYPTION_KEY",
    "",
    "Run with --dry-run first. Dry-run decrypts every stored model API key with the old key without writing updates."
  ].join("\n");
}
