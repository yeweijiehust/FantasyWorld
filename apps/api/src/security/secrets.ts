import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const algorithm = "aes-256-gcm";
export const secretDecryptionRecoveryMessage =
  "Unable to decrypt stored model API key. Verify ENCRYPTION_KEY, restore the database backup taken before the key change, or run pnpm keys:rotate with the previous and new keys.";

export class SecretDecryptionError extends Error {
  constructor(cause?: unknown) {
    super(secretDecryptionRecoveryMessage);
    this.name = "SecretDecryptionError";
    this.cause = cause;
  }
}

export function isValidEncryptionKey(value: string | undefined) {
  return value ? decodeEncryptionKey(value) !== undefined : false;
}

export function encryptSecret(plaintext: string, keyValue: string) {
  const key = resolveEncryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptSecret(payload: string, keyValue: string) {
  try {
    const [version, iv, tag, ciphertext] = payload.split(":");

    if (version !== "v1" || !iv || !tag || !ciphertext) {
      throw new Error("Invalid encrypted secret payload");
    }

    const key = resolveEncryptionKey(keyValue);
    const decipher = createDecipheriv(algorithm, key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new SecretDecryptionError(error);
  }
}

export function rotateEncryptedSecret(payload: string, oldKey: string, newKey: string) {
  return encryptSecret(decryptSecret(payload, oldKey), newKey);
}

export function isSecretDecryptionError(error: unknown): boolean {
  return error instanceof SecretDecryptionError;
}

function resolveEncryptionKey(value: string) {
  return decodeEncryptionKey(value) ?? createHash("sha256").update(value).digest();
}

function decodeEncryptionKey(value: string) {
  try {
    const key = Buffer.from(value, "base64");
    return key.length === 32 ? key : undefined;
  } catch {
    return undefined;
  }
}
