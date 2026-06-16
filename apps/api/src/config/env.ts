import { Compile } from "typebox/compile";
import { Type, type Static } from "typebox";

const EnvSchema = Type.Object({
  NODE_ENV: Type.Optional(Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")])),
  PORT: Type.Optional(Type.String()),
  DATABASE_URL: Type.Optional(Type.String()),
  SESSION_SECRET: Type.Optional(Type.String()),
  ENCRYPTION_KEY: Type.Optional(Type.String()),
  ADMIN_PASSWORD_HASH: Type.Optional(Type.String()),
  WEB_ORIGIN: Type.Optional(Type.String())
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
};

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  if (!check.Check(raw)) {
    throw new Error("Invalid environment variables");
  }

  const value: RawEnv = raw;
  const nodeEnv = value.NODE_ENV ?? "development";

  return {
    nodeEnv,
    port: Number(value.PORT ?? 4000),
    databaseUrl: value.DATABASE_URL ?? "postgres://fantasyworld:fantasyworld@localhost:5432/fantasyworld",
    sessionSecret: value.SESSION_SECRET ?? "development-session-secret-development",
    encryptionKey: value.ENCRYPTION_KEY ?? "development-encryption-key",
    adminPasswordHash: value.ADMIN_PASSWORD_HASH,
    webOrigin: value.WEB_ORIGIN ?? "http://localhost:5173"
  };
}
