import { scryptSync, timingSafeEqual } from "node:crypto";

export function verifyPassword(password: string, encodedHash: string | undefined): boolean {
  if (!encodedHash) {
    return password === "fantasyworld";
  }

  const [algorithm, salt, hash] = encodedHash.split("$");

  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64).toString("base64url");
  const hashBuffer = Buffer.from(hash);
  const candidateBuffer = Buffer.from(candidate);

  if (hashBuffer.length !== candidateBuffer.length) {
    return false;
  }

  return timingSafeEqual(hashBuffer, candidateBuffer);
}
