/**
 * One-time seed: create initial admin and settings from env.
 * Runs db:migrate then seeds. Hash is only ever written to the database, not to .env.
 *
 * Env: ADMIN_EMAIL (required). Then either:
 *   - ADMIN_PASSWORD_HASH_B64 (base64 argon2 hash from Terraform), or
 *   - ADMIN_PASSWORD (plaintext; local/dev only), or
 *   - neither: create admin with a random password; user must use password-reset to set one.
 * Also: ADMIN_REGISTRATION_ENABLED, ADMIN_PUBLIC_FEEDS_ENABLED, ADMIN_HOSTNAME, DOMAIN.
 */
import "dotenv/config";
import argon2 from "argon2";
import { randomBytes } from "crypto";
import { nanoid } from "nanoid";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
// Run migrations first so DB and tables exist
import "../db/migrate.js";
import { db } from "../db/index.js";
import { getDataDir } from "../services/paths.js";
import { normalizeHostname } from "../utils/url.js";

function decodeHashB64(b64: string): string | null {
  try {
    const decoded = Buffer.from(b64.trim(), "base64").toString("utf8");
    return decoded.startsWith("$argon2") ? decoded : null;
  } catch {
    return null;
  }
}

const SETUP_TOKEN_FILENAME = "setup-token.txt";

function writeSetting(key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(key, value);
}

function isSetupComplete(): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
    count: number;
  };
  return row.count > 0;
}

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const hashB64 = process.env.ADMIN_PASSWORD_HASH_B64?.trim();
  const password = process.env.ADMIN_PASSWORD?.trim();

  if (!email || !email.includes("@")) {
    console.warn("[seed-setup] Skipped: ADMIN_EMAIL (valid email) required.");
    process.exit(0);
  }

  if (isSetupComplete()) {
    // Persistent data reattach: update admin if email or password hash changed
    const existing = db
      .prepare(
        "SELECT id, email, password_hash FROM users WHERE role = 'admin' LIMIT 1",
      )
      .get() as { id: string; email: string; password_hash: string } | undefined;
    if (existing) {
      const emailNorm = email.toLowerCase();
      let newHash: string | null = null;
      if (hashB64) {
        const decoded = decodeHashB64(hashB64);
        if (decoded) newHash = decoded;
      } else if (password) {
        newHash = await argon2.hash(password);
      }
      const emailChanged = existing.email !== emailNorm;
      const hashChanged =
        newHash !== null && existing.password_hash !== newHash;
      if (emailChanged || hashChanged) {
        if (newHash === null && hashChanged) {
          console.warn(
            "[seed-setup] ADMIN_PASSWORD_HASH_B64 invalid or missing; not updating password.",
          );
        }
        if (emailChanged) {
          db.prepare("UPDATE users SET email = ? WHERE id = ?").run(
            emailNorm,
            existing.id,
          );
        }
        if (hashChanged && newHash !== null) {
          db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
            newHash,
            existing.id,
          );
        }
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
        const emailProvider =
          process.env.EMAIL_PROVIDER?.trim()?.toLowerCase();
        const emailWebhookUrl = process.env.EMAIL_WEBHOOK_URL?.trim();
        const emailWebhookFieldKey =
          process.env.EMAIL_WEBHOOK_FIELD_KEY?.trim() || "content";
        if (emailProvider === "webhook" && emailWebhookUrl) {
          writeSetting("email_provider", "webhook");
          writeSetting("email_webhook_url", emailWebhookUrl);
          writeSetting("email_webhook_field_key", emailWebhookFieldKey);
        }
        console.info(
          `[seed-setup] Updated admin (email=${emailChanged} hash=${hashChanged}).`,
        );
      } else {
        console.info("[seed-setup] Setup already complete, no changes needed.");
      }
    } else {
      console.info("[seed-setup] Setup already complete, skipping.");
    }
    process.exit(0);
  }

  let passwordHash: string;
  if (hashB64) {
    const decoded = decodeHashB64(hashB64);
    if (!decoded) {
      console.warn("[seed-setup] ADMIN_PASSWORD_HASH_B64 invalid (expected base64 of argon2 hash). Skipping.");
      process.exit(0);
    }
    passwordHash = decoded;
  } else if (password) {
    passwordHash = await argon2.hash(password);
  } else {
    const randomPassword = randomBytes(32).toString("base64url");
    passwordHash = await argon2.hash(randomPassword);
    console.info(
      "[seed-setup] No password provided; created admin with random password. Use the login page \"Forgot password\" to set a new password.",
    );
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

  const emailProvider = process.env.EMAIL_PROVIDER?.trim()?.toLowerCase();
  const emailWebhookUrl = process.env.EMAIL_WEBHOOK_URL?.trim();
  const emailWebhookFieldKey =
    process.env.EMAIL_WEBHOOK_FIELD_KEY?.trim() || "content";
  if (emailProvider === "webhook" && emailWebhookUrl) {
    writeSetting("email_provider", "webhook");
    writeSetting("email_webhook_url", emailWebhookUrl);
    writeSetting("email_webhook_field_key", emailWebhookFieldKey);
  }

  const setupTokenPath = join(getDataDir(), SETUP_TOKEN_FILENAME);
  if (existsSync(setupTokenPath)) {
    try {
      unlinkSync(setupTokenPath);
    } catch {
      /* ignore */
    }
  }

  console.info(`[seed-setup] Created admin user: ${email}`);
}

main().catch((err) => {
  console.error("[seed-setup] Failed:", err);
  process.exit(1);
});
