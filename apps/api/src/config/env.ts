import { Compile } from "typebox/compile";
import { Type, type Static } from "typebox";
import { isValidEncryptionKey } from "../security/secrets.js";

const EnvSchema = Type.Object({
  NODE_ENV: Type.Optional(Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")])),
  PORT: Type.Optional(Type.String()),
  DATABASE_URL: Type.Optional(Type.String()),
  SESSION_SECRET: Type.Optional(Type.String()),
  ENCRYPTION_KEY: Type.Optional(Type.String()),
  ADMIN_PASSWORD_HASH: Type.Optional(Type.String()),
  WEB_ORIGIN: Type.Optional(Type.String()),
  DATA_STORE: Type.Optional(Type.Union([Type.Literal("postgres"), Type.Literal("memory")]))
});

type RawEnv = Static<typeof EnvSchema>;

const check = Compile(EnvSchema);

export type AppEnv = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  encryptionKey: string;
  adminPasswordHash: string | undefined;
  webOrigin: string;
  dataStore: "postgres" | "memory";
};

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  if (!check.Check(raw)) {
    throw new Error("Invalid environment variables");
  }

  const value: RawEnv = raw;
  const nodeEnv = value.NODE_ENV ?? "development";
  const dataStore = value.DATA_STORE ?? "postgres";
  const databaseUrl = value.DATABASE_URL ?? "postgres://fantasyworld:fantasyworld@localhost:5432/fantasyworld";
  const sessionSecret = value.SESSION_SECRET ?? "development-session-secret-development";
  const encryptionKey = value.ENCRYPTION_KEY ?? "development-encryption-key";

  validateProductionEnv({
    nodeEnv,
    dataStore,
    databaseUrl: value.DATABASE_URL,
    sessionSecret: value.SESSION_SECRET,
    encryptionKey: value.ENCRYPTION_KEY,
    adminPasswordHash: value.ADMIN_PASSWORD_HASH
  });

  return {
    nodeEnv,
    port: Number(value.PORT ?? 4000),
    databaseUrl,
    sessionSecret,
    encryptionKey,
    adminPasswordHash: value.ADMIN_PASSWORD_HASH,
    webOrigin: value.WEB_ORIGIN ?? "http://localhost:5173",
    dataStore
  };
}

function validateProductionEnv(input: {
  nodeEnv: AppEnv["nodeEnv"];
  dataStore: AppEnv["dataStore"];
  databaseUrl: string | undefined;
  sessionSecret: string | undefined;
  encryptionKey: string | undefined;
  adminPasswordHash: string | undefined;
}) {
  if (input.nodeEnv !== "production") {
    return;
  }

  if (input.dataStore !== "postgres") {
    throw new Error("DATA_STORE must be postgres in production");
  }

  if (!input.databaseUrl) {
    throw new Error("DATABASE_URL is required in production");
  }

  if (!input.sessionSecret || input.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
  }

  if (!isValidEncryptionKey(input.encryptionKey)) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte base64 value in production");
  }

  if (!input.adminPasswordHash?.startsWith("scrypt$")) {
    throw new Error("ADMIN_PASSWORD_HASH is required in production");
  }
}
