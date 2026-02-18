/**
 * One-off: send the same "welcome + set-password link" email to the seeded admin
 * that we send when an admin creates a user. Used at end of user-data when
 * ADMIN_EMAIL is set and email provider is webhook (so the admin gets one email
 * with a link to set/change password).
 *
 * Usage: ADMIN_EMAIL=admin@example.com pnpm run send-seed-admin-welcome
 * Requires: DATA_DIR (and SECRETS_DIR) set; settings in DB (from seed-setup).
 */
import "dotenv/config";
import { randomBytes } from "crypto";
import { RESET_TOKEN_EXPIRY_HOURS } from "../config.js";
import { db } from "../db/index.js";
import { sha256Hex } from "../utils/hash.js";
import { readSettings } from "../modules/settings/index.js";
import { sendMail, buildWelcomeSetPasswordEmail } from "../services/email.js";
import { normalizeHostname } from "../utils/url.js";

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  if (!email || !email.includes("@")) {
    console.warn("[send-seed-admin-welcome] ADMIN_EMAIL (valid email) required. Skipping.");
    process.exit(0);
  }

  const settings = readSettings();
  const emailConfigured =
    (settings.email_provider === "smtp" ||
      settings.email_provider === "sendgrid" ||
      settings.email_provider === "webhook") &&
    (settings.email_provider === "webhook"
      ? Boolean(settings.email_webhook_url?.trim())
      : true);
  if (!emailConfigured || !settings.email_enable_admin_welcome) {
    console.warn(
      "[send-seed-admin-welcome] Email not configured or admin welcome disabled. Skipping.",
    );
    process.exit(0);
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO password_reset_tokens (email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(email, tokenHash, expiresAt.toISOString(), now);

  const baseUrl =
    normalizeHostname(settings.hostname || "") || "http://localhost";
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const { subject, text, html } = buildWelcomeSetPasswordEmail(
    resetUrl,
    baseUrl,
    RESET_TOKEN_EXPIRY_HOURS,
  );
  const result = await sendMail({ to: email, subject, text, html });
  if (result.sent) {
    console.info(`[send-seed-admin-welcome] Sent welcome/set-password email to ${email}`);
  } else {
    console.warn(`[send-seed-admin-welcome] Failed to send: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[send-seed-admin-welcome]", err);
  process.exit(1);
});
