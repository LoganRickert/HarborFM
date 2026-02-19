import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { AppSettings } from "../settings/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to initial-assets.json (under server/). */
export const INITIAL_ASSETS_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "initial-assets.json",
);

export type InitialAsset = {
  name: string;
  tag?: string | null;
  copyright?: string | null;
  license?: string | null;
  download: string;
  source: string;
};

/** Build the GET /setup/status response when setup is already complete. */
export function buildSetupStatusResponse(settings: AppSettings) {
  const captchaProvider = settings.captcha_provider ?? "none";
  const captchaSiteKey =
    captchaProvider !== "none" ? (settings.captcha_site_key ?? "") : "";
  const emailConfigured =
    settings.email_provider === "smtp" ||
    settings.email_provider === "sendgrid" ||
    settings.email_provider === "webhook";
  return {
    setupRequired: false as const,
    registrationEnabled: Boolean(settings.registration_enabled),
    publicFeedsEnabled: Boolean(settings.public_feeds_enabled),
    captchaProvider,
    captchaSiteKey,
    emailConfigured,
    welcomeBanner: String(settings.welcome_banner ?? ""),
    twoFactorEnabled: Boolean(settings.two_factor_enabled),
    twoFactorEnforced: Boolean(
      settings.two_factor_enabled && settings.two_factor_enforced,
    ),
    twoFactorMethods: String(settings.two_factor_methods ?? "totp"),
  };
}
