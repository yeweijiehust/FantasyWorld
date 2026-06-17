import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import { DatabaseStore } from "../store/database-store.js";

const { Pool } = pg;

export function createDatabaseStore(databaseUrl: string, encryptionKey: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  return {
    store: new DatabaseStore(db, encryptionKey),
    close: () => pool.end()
  };
}
