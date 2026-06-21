import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isSecretDecryptionError,
  rotateEncryptedSecret,
  secretDecryptionRecoveryMessage
} from "./secrets.js";

const oldKey = Buffer.alloc(32, 11).toString("base64");
const newKey = Buffer.alloc(32, 12).toString("base64");

describe("stored secret encryption", () => {
  it("rotates encrypted payloads from the old encryption key to the new key", () => {
    const secret = "test-secret-api-key-value";
    const originalPayload = encryptSecret(secret, oldKey);
    const rotatedPayload = rotateEncryptedSecret(originalPayload, oldKey, newKey);

    expect(decryptSecret(originalPayload, oldKey)).toBe(secret);
    expect(decryptSecret(rotatedPayload, newKey)).toBe(secret);
    expect(() => decryptSecret(originalPayload, newKey)).toThrow(secretDecryptionRecoveryMessage);
  });

  it("returns an actionable recovery hint when decryption fails", () => {
    try {
      decryptSecret("v1:invalid:payload:value", oldKey);
      throw new Error("Expected decryptSecret to fail");
    } catch (error) {
      expect(isSecretDecryptionError(error)).toBe(true);
      expect(error).toMatchObject({ message: secretDecryptionRecoveryMessage });
    }
  });
});
