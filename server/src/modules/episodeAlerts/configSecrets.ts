import { encryptSecret, decryptSecret, isEncryptedSecret } from "../../services/secrets.js";
import { EPISODE_ALERT_SECRETS_AAD } from "../../config.js";

export const SECRET_CONFIG_KEYS = [
  "smtpPassword",
  "sendgridApiKey",
  "botToken",
  "accessToken",
  "password",
  "jwt",
  "appPassword",
] as const;

export type SecretConfigKey = (typeof SECRET_CONFIG_KEYS)[number];

export function encryptConfigSecrets(
  config: Record<string, unknown>,
  previous?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of SECRET_CONFIG_KEYS) {
    const raw = out[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string") {
      delete out[key];
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "(set)") {
      if (previous && typeof previous[key] === "string" && previous[key]) {
        out[key] = previous[key];
      } else {
        delete out[key];
      }
      continue;
    }
    if (isEncryptedSecret(trimmed)) {
      out[key] = trimmed;
      continue;
    }
    out[key] = encryptSecret(trimmed, EPISODE_ALERT_SECRETS_AAD);
  }
  return out;
}

export function decryptConfigSecret(
  config: Record<string, unknown>,
  key: SecretConfigKey,
): string | null {
  const raw = config[key];
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    if (isEncryptedSecret(raw)) {
      return decryptSecret(raw, EPISODE_ALERT_SECRETS_AAD);
    }
    return raw;
  } catch {
    return null;
  }
}

export function redactConfigSecrets(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of SECRET_CONFIG_KEYS) {
    if (typeof out[key] === "string" && String(out[key]).trim()) {
      out[key] = "(set)";
    }
  }
  return out;
}

export function parseConfigJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}
