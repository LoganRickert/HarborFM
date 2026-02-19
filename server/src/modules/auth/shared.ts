import { randomBytes, randomInt } from "crypto";
import { nanoid } from "nanoid";
import { getCookieSecureFlag } from "../../services/cookies.js";
import {
  VERIFICATION_TOKEN_BYTES,
  VERIFICATION_EXPIRY_HOURS,
  RESET_TOKEN_BYTES,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  AUTH_CHALLENGE_TOKEN_BYTES,
  AUTH_2FA_CHALLENGE_EXPIRY_MS,
  TWOFA_CHALLENGE_COOKIE_NAME,
} from "../../config.js";
import { sha256Hex } from "../../utils/hash.js";
import { normalizeHostname } from "../../utils/url.js";
import { readSettings } from "../settings/index.js";
import type { AppSettings } from "../settings/index.js";
import {
  TWO_FACTOR_METHODS,
  parseTwoFactorMethods,
  isMethodAllowed,
} from "@harborfm/shared";
import { drizzleDb } from "../../db/index.js";
import { auth2faChallenges } from "../../db/schema.js";

export { VERIFICATION_TOKEN_BYTES, VERIFICATION_EXPIRY_HOURS, RESET_TOKEN_BYTES };

/** Base URL for auth links (emails, redirects). Strips trailing slash. */
export function getBaseUrl(settings?: AppSettings): string {
  const s = settings ?? readSettings();
  const base = normalizeHostname(s.hostname || "") || "http://localhost";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

const COOKIE_SECURE = getCookieSecureFlag();
const TWOFA_CHALLENGE_MAX_AGE_SEC = Math.floor(AUTH_2FA_CHALLENGE_EXPIRY_MS / 1000);
/** HttpOnly cookie for 2FA challenge token (not in URL). Path=/ so it's sent with API requests. */
export const TWOFA_CHALLENGE_COOKIE_OPTS = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge: TWOFA_CHALLENGE_MAX_AGE_SEC,
};

/** Create 2FA challenge in DB and return the challenge token for the cookie. */
export function create2FAChallenge(
  userId: string,
  method: string,
): { challengeToken: string } {
  const challengeId = nanoid(32);
  const challengeToken = randomBytes(AUTH_CHALLENGE_TOKEN_BYTES).toString(
    "base64url",
  );
  const tokenHash = sha256Hex(challengeToken);
  const expiresAt = new Date(
    Date.now() + AUTH_2FA_CHALLENGE_EXPIRY_MS,
  ).toISOString();
  drizzleDb.insert(auth2faChallenges).values({
    id: challengeId,
    userId,
    tokenHash,
    method: method as "totp" | "email",
    expiresAt,
  }).run();
  return { challengeToken };
}

/** Resolve which 2FA method to use for a user (totp or email). */
export function resolve2FAMethod(
  row: { twoFactorMethod?: string | null; email?: string | null },
  allowedMethods: string[],
  emailProviderConfigured: boolean,
): "totp" | "email" {
  const userMethods = parseTwoFactorMethods(row.twoFactorMethod || "");
  const emailAvailable =
    isMethodAllowed(allowedMethods, "email") && emailProviderConfigured;
  return userMethods.includes("email") &&
    emailAvailable &&
    Boolean(row.email)
    ? "email"
    : "totp";
}

/** Build list of 2FA methods available for setup (allowed + provider configured if needed). */
export function buildSetupMethods(
  allowedMethods: string[],
  emailProviderConfigured: boolean,
  row: { email?: string | null },
): ("totp" | "email")[] {
  return TWO_FACTOR_METHODS.filter((m) => {
    if (!isMethodAllowed(allowedMethods, m.id)) return false;
    if (m.requiresProvider === "email")
      return emailProviderConfigured && Boolean(row.email?.trim());
    return true;
  }).map((m) => m.id as "totp" | "email");
}

/** Create a rate-limit key generator for 2FA routes: uses challenge token hash or IP fallback. */
export function create2FARateLimitKeyGen(prefix: string) {
  return (request: { cookies?: Record<string, string | undefined>; ip?: string }) => {
    const token = get2FAChallengeToken(request);
    if (token) return `${prefix}:${sha256Hex(token)}`;
    return `${prefix}:ip:${(request.ip || "").trim() || "unknown"}`;
  };
}

/** Build JWT payload for auth cookie (sub, email, username). */
export function buildAuthJwtPayload(user: {
  id: string;
  email?: string | null;
  username?: string | null;
}): { sub: string; email: string | null; username: string | null } {
  return {
    sub: user.id,
    email: user.email ?? null,
    username: user.username ?? null,
  };
}

/** Get 2FA challenge token from HttpOnly cookie only. */
export function get2FAChallengeToken(request: {
  cookies?: Record<string, string | undefined>;
}): string | null {
  const cookies = request.cookies ?? {};
  const fromCookie = cookies[TWOFA_CHALLENGE_COOKIE_NAME]?.trim();
  return fromCookie || null;
}

export const COOKIE_OPTS = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
};
export const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
};

/** Redact email for logging (avoid logging username in plain text). */
export function redactEmail(email: string): string {
  const s = email.trim();
  if (!s || !s.includes("@")) return "(invalid)";
  const [local, domain] = s.split("@");
  if (!domain) return "(invalid)";
  const showLocal = local.length <= 2 ? "**" : local.slice(0, 1) + "***";
  return `${showLocal}@${domain}`;
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Generate cryptographically secure 6-digit OTP (100000–999999). */
export function generateSecureOtp(): string {
  return String(randomInt(100000, 1000000));
}

export function requireSession(
  request: { authViaApiKey?: boolean; userId: string },
  reply: {
    status: (code: number) => { send: (body: unknown) => unknown };
    sent?: boolean;
  },
): boolean {
  if (request.authViaApiKey) {
    reply
      .status(403)
      .send({
        error: "API key management requires signing in with your password.",
      });
    return false;
  }
  return true;
}
