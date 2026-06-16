import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error("Usage: pnpm auth:hash <password>");
  process.exit(1);
}

const salt = randomBytes(16).toString("base64url");
const hash = scryptSync(password, salt, 64).toString("base64url");

if (!timingSafeEqual(Buffer.from(hash), Buffer.from(hash))) {
  process.exit(1);
}

console.log(`scrypt$${salt}$${hash}`);
