/**
 * Deletes expired 2FA challenges, OTP codes, and old TOTP attempt records.
 * Run periodically (e.g. via cron) to keep tables from growing indefinitely.
 */
import { db } from "./index.js";

const challengesResult = db
  .prepare(
    "DELETE FROM auth_2fa_challenges WHERE datetime(expires_at) <= datetime('now')",
  )
  .run();

const otpCodesResult = db
  .prepare(
    "DELETE FROM user_otp_codes WHERE datetime(expires_at) <= datetime('now')",
  )
  .run();

// TOTP attempts older than 15 minutes are not used for lockout counting
const attemptsResult = db
  .prepare(
    "DELETE FROM user_totp_attempts WHERE datetime(created_at) < datetime('now', '-15 minutes')",
  )
  .run();

console.log(
  "Cleared stale 2FA data: %d challenges, %d OTP codes, %d TOTP attempts.",
  challengesResult.changes,
  otpCodesResult.changes,
  attemptsResult.changes,
);
