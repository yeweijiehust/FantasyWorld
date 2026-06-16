import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDatabaseStore } from "./db/client.js";
import { prototypeStore } from "./store/prototype-store.js";

const env = loadEnv();
const runtime =
  env.dataStore === "memory"
    ? { store: prototypeStore, close: () => Promise.resolve() }
    : createDatabaseStore(env.databaseUrl);
const app = buildApp({ env, store: runtime.store });

app.addHook("onClose", async () => {
  await runtime.close();
});

await app.listen({ port: env.port, host: "0.0.0.0" });
