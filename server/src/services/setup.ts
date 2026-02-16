import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { SETUP_ID } from "../config.js";
import { ensureDir, getDataDir } from "./paths.js";
import { normalizeHostname } from "../utils/url.js";

const SETUP_TOKEN_FILENAME = "setup-token.txt";

function writeSetting(key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(key, value);
}

/**
 * Bootstrap admin from ADMIN_EMAIL + ADMIN_PASSWORD_HASH when set.
 * Used by Terraform/user-data to avoid passing the plaintext password.
 * Hash must be argon2 format (from Terraform external data source or similar).
 * Reads process.env at runtime so we see env set by PM2 env_file / dotenv after process start.
 */
export function bootstrapIfNeeded(): boolean {
  if (isSetupComplete()) return false;

  const email = process.env.ADMIN_EMAIL?.trim() || null;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH?.trim() || null;

  if (!email || !email.includes("@") || !passwordHash) {
    const hasEmail = Boolean(email || process.env.ADMIN_EMAIL?.trim());
    const hasHash = Boolean(passwordHash || process.env.ADMIN_PASSWORD_HASH?.trim());
    if (hasEmail || hasHash) {
      console.warn(
        `[setup] Bootstrap skipped: ADMIN_EMAIL (set=${hasEmail}) and ADMIN_PASSWORD_HASH (set=${hasHash}) both required`,
      );
    }
    return false;
  }

  // Argon2 hashes start with $argon2
  if (!passwordHash.startsWith("$argon2")) {
    console.warn(
      `[setup] ADMIN_PASSWORD_HASH must start with $argon2; skipping bootstrap. Check server/.env. Got first 20 chars: ${JSON.stringify(passwordHash.slice(0, 20))}`,
    );
    return false;
  }

  const id = nanoid();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, role, can_transcribe) VALUES (?, ?, ?, ?, 1)",
  ).run(id, email.toLowerCase(), passwordHash, "admin");

  const hostnameRaw =
    process.env.ADMIN_HOSTNAME?.trim() ||
    (process.env.DOMAIN &&
    process.env.DOMAIN !== "localhost" &&
    process.env.DOMAIN !== "_"
      ? `https://${process.env.DOMAIN}`
      : "");
  const hostname = hostnameRaw ? normalizeHostname(hostnameRaw) : "";
  writeSetting("hostname", hostname);
  writeSetting(
    "registration_enabled",
    process.env.ADMIN_REGISTRATION_ENABLED === "1" ? "true" : "false",
  );
  writeSetting(
    "public_feeds_enabled",
    process.env.ADMIN_PUBLIC_FEEDS_ENABLED === "1" ? "true" : "false",
  );
  writeSetting("setup_completed", "true");

  // Remove setup token file so the manual setup URL is no longer valid
  const path = getSetupTokenPath();
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }

  console.info(`[setup] Bootstrapped admin user: ${email}`);
  return true;
}

export function isSetupComplete(): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
    count: number;
  };
  if (row.count > 0) return true;
  // Fallback: settings table may have setup_completed from seed/bootstrap
  const setting = db.prepare(
    "SELECT value FROM settings WHERE key = 'setup_completed'"
  ).get() as { value: string } | undefined;
  return setting?.value === "true";
}

function getSetupTokenPath(): string {
  return join(getDataDir(), SETUP_TOKEN_FILENAME);
}

export function readSetupToken(): string | null {
  if (SETUP_ID) return SETUP_ID;

  const path = getSetupTokenPath();
  if (!existsSync(path)) return null;
  const token = readFileSync(path, "utf8").trim();
  return token || null;
}

export function getOrCreateSetupToken(): string {
  if (isSetupComplete()) {
    throw new Error("Setup is already complete");
  }

  if (SETUP_ID) return SETUP_ID;

  ensureDir(getDataDir());

  const existing = readSetupToken();
  if (existing) return existing;

  const token = nanoid(32);
  const path = getSetupTokenPath();
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort only.
  }
  return token;
}

export function consumeSetupToken(token: string): boolean {
  const existing = readSetupToken();
  if (!existing) return false;
  if (token !== existing) return false;
  try {
    unlinkSync(getSetupTokenPath());
  } catch {
    // Ignore deletion errors; token won't be reusable anyway if setup completes.
  }
  return true;
}
