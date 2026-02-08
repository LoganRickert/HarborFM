import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ensureSecretsDir, getSecretsDir } from './paths.js';

const SECRETS_KEY_ENV = 'HARBORFM_SECRETS_KEY';
const SECRETS_KEY_FILENAME = 'secrets-key.txt';

let cachedKey: Buffer | null = null;

function getSecretsKeyPath(): string {
  return join(getSecretsDir(), SECRETS_KEY_FILENAME);
}

/**
 * Returns the 32-byte master key used to encrypt secrets at rest.
 *
 * - Prefer env var `HARBORFM_SECRETS_KEY` (base64/base64url)
 * - Otherwise, generate once and persist under DATA_DIR
 */
export function getSecretsKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env[SECRETS_KEY_ENV]?.trim();
  if (fromEnv) {
    const b64 = fromEnv.replace(/-/g, '+').replace(/_/g, '/');
    const raw = Buffer.from(b64, 'base64');
    if (raw.length !== 32) {
      throw new Error(`${SECRETS_KEY_ENV} must decode to exactly 32 bytes`);
    }
    cachedKey = raw;
    return raw;
  }

  ensureSecretsDir();
  const path = getSecretsKeyPath();
  if (existsSync(path)) {
    console.warn(
      `[security] ${SECRETS_KEY_ENV} is not set in the environment. ` +
        `Using the persisted secrets key at ${path}. ` +
        `Set ${SECRETS_KEY_ENV} via env (Docker/PM2) to make key management explicit.`
    );
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) {
      const b64 = existing.replace(/-/g, '+').replace(/_/g, '/');
      const raw = Buffer.from(b64, 'base64');
      if (raw.length === 32) {
        cachedKey = raw;
        return raw;
      }
    }
  }

  const raw = randomBytes(32);
  const encoded = raw.toString('base64url');
  writeFileSync(path, `${encoded}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort: chmod may fail on some FS / platforms.
  }
  console.warn(
    `[security] ${SECRETS_KEY_ENV} is not set; generated and persisted a secrets key at ${path}. ` +
      `Persist SECRETS_DIR to avoid losing access to encrypted credentials.`
  );
  cachedKey = raw;
  return raw;
}

/**
 * Encrypt a UTF-8 string using AES-256-GCM.
 * Format: v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
 */
export function encryptSecret(plaintext: string, aad = 'harborfm'): string {
  const key = getSecretsKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('v1:');
}

export function decryptSecret(payload: string, aad = 'harborfm'): string {
  const key = getSecretsKey();
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted secret format');
  }
  const iv = Buffer.from(parts[1]!, 'base64url');
  const tag = Buffer.from(parts[2]!, 'base64url');
  const ciphertext = Buffer.from(parts[3]!, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function redactAccessKeyId(accessKeyId: string): string {
  const s = String(accessKeyId || '').trim();
  if (!s) return '';
  const last4 = s.slice(-4);
  return `****${last4}`;
}

