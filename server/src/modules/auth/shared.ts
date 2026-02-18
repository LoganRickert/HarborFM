import { randomBytes, randomInt } from "crypto";
import { getCookieSecureFlag } from "../../services/cookies.js";

export const VERIFICATION_TOKEN_BYTES = 24;
export const VERIFICATION_EXPIRY_HOURS = 24;
export const RESET_TOKEN_BYTES = 32;

const COOKIE_SECURE = getCookieSecureFlag();
export const COOKIE_OPTS = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7, // 7 days
};
export const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7, // 7 days
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
