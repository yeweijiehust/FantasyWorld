import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = buildApp({ env });

await app.listen({ port: env.port, host: "0.0.0.0" });
