/**
 * Deletes expired 2FA challenges, OTP codes, old TOTP attempt records, and SSO OAuth state.
 * Run periodically (e.g. via cron) to keep tables from growing indefinitely.
 */
import { sql } from "drizzle-orm";
import { drizzleDb } from "./drizzle.js";
import {
  auth2faChallenges,
  userOtpCodes,
  userTotpAttempts,
  ssoOauthState,
  ssoSamlState,
  ssoSamlCache,
} from "./schema.js";

const challengesResult = drizzleDb
  .delete(auth2faChallenges)
  .where(sql`datetime(${auth2faChallenges.expiresAt}) <= datetime('now')`)
  .run();

const otpCodesResult = drizzleDb
  .delete(userOtpCodes)
  .where(sql`datetime(${userOtpCodes.expiresAt}) <= datetime('now')`)
  .run();

// TOTP attempts older than 15 minutes are not used for lockout counting
const attemptsResult = drizzleDb
  .delete(userTotpAttempts)
  .where(sql`datetime(${userTotpAttempts.createdAt}) < datetime('now', '-15 minutes')`)
  .run();

// SSO OAuth state older than 10 minutes is expired and unusable
const ssoStateResult = drizzleDb
  .delete(ssoOauthState)
  .where(sql`datetime(${ssoOauthState.createdAt}) < datetime('now', '-10 minutes')`)
  .run();

// SAML RelayState and request ID cache older than 10 minutes
const samlStateResult = drizzleDb
  .delete(ssoSamlState)
  .where(sql`datetime(${ssoSamlState.createdAt}) < datetime('now', '-10 minutes')`)
  .run();
const samlCacheResult = drizzleDb
  .delete(ssoSamlCache)
  .where(sql`datetime(${ssoSamlCache.createdAt}) < datetime('now', '-10 minutes')`)
  .run();

console.log(
  "Cleared stale auth data: %d 2FA challenges, %d OTP codes, %d TOTP attempts, %d SSO OAuth states, %d SAML states, %d SAML cache entries.",
  challengesResult.changes,
  otpCodesResult.changes,
  attemptsResult.changes,
  ssoStateResult.changes,
  samlStateResult.changes,
  samlCacheResult.changes,
);
