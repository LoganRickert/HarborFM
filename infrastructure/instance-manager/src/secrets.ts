import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const MANAGER_SECRET_ENV = "MANAGER_SECRET";
let cachedKey: Buffer | null | undefined = undefined;

/**
 * Returns the 32-byte key if MANAGER_SECRET is set and valid (base64 to 32 bytes), else null.
 * No file fallback; key must be set in env when encryption is desired.
 */
export function getManagerKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const fromEnv = process.env.MANAGER_SECRET?.trim();
  if (!fromEnv) {
    cachedKey = null;
    return null;
  }
  const b64 = fromEnv.replace(/-/g, "+").replace(/_/g, "/");
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) {
    throw new Error(`${MANAGER_SECRET_ENV} must decode to exactly 32 bytes (got ${raw.length})`);
  }
  cachedKey = raw;
  return raw;
}

/**
 * Encrypt a UTF-8 string using AES-256-GCM.
 * Format: v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
 * Only call when getManagerKey() is non-null.
 */
export function encryptSecret(plaintext: string, aad: string): string {
  const key = getManagerKey();
  if (!key) throw new Error(`${MANAGER_SECRET_ENV} is required for encryption`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function isEncrypted(payload: string | null | undefined): boolean {
  return typeof payload === "string" && payload.startsWith("v1:");
}

/**
 * Decrypt a v1: payload. Throws on wrong key, tampered data, or invalid format.
 * Only call when getManagerKey() is non-null.
 */
export function decryptSecret(payload: string, aad: string): string {
  const key = getManagerKey();
  if (!key) throw new Error(`${MANAGER_SECRET_ENV} is required for decryption`);
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted secret format");
  }
  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const ciphertext = Buffer.from(parts[3]!, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
