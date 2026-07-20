import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { drizzleDb } from "../db/drizzle.js";
import { settings, users } from "../db/schema.js";
import { sqlNow } from "../db/utils.js";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD_HASH,
  ADMIN_PASSWORD_HASH_FILE,
  ADMIN_PUBLIC_FEEDS_ENABLED,
  ADMIN_REGISTRATION_ENABLED,
  getAdminHostnameFromEnv,
  SETUP_ID,
} from "../config.js";
import { ensureDir, getDataDir } from "./paths.js";
import { normalizeHostname } from "../utils/url.js";
import { timingSafeEqualStrings } from "../utils/secretCompare.js";

const SETUP_TOKEN_FILENAME = "setup-token.txt";

function writeSetting(key: string, value: string): void {
  const now = sqlNow();
  drizzleDb
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: now },
    })
    .run();
}

/**
 * Read admin password hash from env or from file (ADMIN_PASSWORD_HASH_FILE).
 * Prefers file when ADMIN_PASSWORD_HASH_FILE is set and file exists.
 */
function getAdminPasswordHash(): string | null {
  const filePath = ADMIN_PASSWORD_HASH_FILE;
  if (filePath) {
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf8").trim();
        if (content) return content;
      }
    } catch {
      /* fall through to env */
    }
  }
  return ADMIN_PASSWORD_HASH;
}

/**
 * Bootstrap admin from ADMIN_EMAIL + ADMIN_PASSWORD_HASH when set.
 * Used by Terraform/user-data to avoid passing the plaintext password.
 * Hash must be argon2 format (from Terraform external data source or similar).
 * Reads from ADMIN_PASSWORD_HASH_FILE (preferred) or ADMIN_PASSWORD_HASH from config.
 */
export function bootstrapIfNeeded(): boolean {
  if (isSetupComplete()) return false;

  const email = ADMIN_EMAIL;
  const passwordHash = getAdminPasswordHash();

  if (!email || !email.includes("@") || !passwordHash) {
    const hasEmail = Boolean(email || ADMIN_EMAIL);
    const hasHash = Boolean(
      passwordHash || ADMIN_PASSWORD_HASH || ADMIN_PASSWORD_HASH_FILE,
    );
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
  drizzleDb.insert(users).values({
    id,
    email: email.toLowerCase(),
    passwordHash,
    role: "admin",
    canTranscribe: 1,
    canGenerateVideo: 1,
    canStripe: 1,
    canEpisodeAlert: 1,
    canUploadEpisodeFiles: 1,
    canImportTheme: 1,
  }).run();

  const hostnameRaw = getAdminHostnameFromEnv();
  const hostname = hostnameRaw ? normalizeHostname(hostnameRaw) : "";
  writeSetting("hostname", hostname);
  writeSetting(
    "registration_enabled",
    ADMIN_REGISTRATION_ENABLED ? "true" : "false",
  );
  writeSetting(
    "public_feeds_enabled",
    ADMIN_PUBLIC_FEEDS_ENABLED ? "true" : "false",
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
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)`.as("count") })
    .from(users)
    .get();
  if ((row?.count ?? 0) > 0) return true;
  // Fallback: settings table may have setup_completed from seed/bootstrap
  const setting = drizzleDb
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "setup_completed"))
    .limit(1)
    .get() as { value: string } | undefined;
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
  if (!timingSafeEqualStrings(token, existing)) return false;
  try {
    unlinkSync(getSetupTokenPath());
  } catch {
    // Ignore deletion errors; token won't be reusable anyway if setup completes.
  }
  return true;
}
