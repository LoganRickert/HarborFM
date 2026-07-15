import { readFileSync, existsSync } from "fs";
import { drizzleDb } from "../../db/index.js";
import { settings as settingsTable } from "../../db/schema.js";
import { eq, inArray, sql } from "drizzle-orm";
import { sqlNow } from "../../db/utils.js";
import {
  DEFAULTS,
  buildAppSettingsFromRows,
  OPENAI_DEFAULT_MODEL,
  getSettingsPath,
  type AppSettings,
} from "./utils.js";
import {
  WEBRTC_SERVICE_URL,
  WEBRTC_PUBLIC_WS_URL,
} from "../../config.js";

function parseSettingRow(row: Record<string, unknown>): { key: string; value: string } {
  const key = row.key ?? row["key"];
  const value = row.value ?? row["value"];
  if (key != null && value != null) return { key: String(key), value: String(value) };
  const vals = Object.values(row).filter((v) => v != null);
  return { key: String(vals[0] ?? ""), value: String(vals[1] ?? "") };
}

export function getAllSettingsRows(): Array<{ key: string; value: string }> {
  const rawRows = drizzleDb
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .all();
  return (rawRows as Array<Record<string, unknown>>).map(parseSettingRow);
}

/** Read SSO OIDC providers from DB and redact secrets for client. */
export function getSsoOidcProvidersForSettings(): Array<Record<string, unknown>> {
  try {
    const row = drizzleDb
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, "sso_oidc_providers"))
      .limit(1)
      .get() as { value: string } | undefined;
    if (!row?.value?.trim()) return [];
    const arr = JSON.parse(row.value) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr)) return [];
    return arr.map((p) => {
      const out = { ...p };
      if (out.clientSecret || out.clientSecretEnc) {
        out.clientSecret = "(set)";
        delete out.clientSecretEnc;
      }
      return out;
    });
  } catch {
    return [];
  }
}

/** Read SSO SAML providers from DB and redact secrets for client. */
export function getSsoSamlProvidersForSettings(): Array<Record<string, unknown>> {
  try {
    const row = drizzleDb
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, "sso_saml_providers"))
      .limit(1)
      .get() as { value: string } | undefined;
    if (!row?.value?.trim()) return [];
    const arr = JSON.parse(row.value) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr)) return [];
    return arr.map((p) => {
      const out = { ...p };
      if (out.cert || out.certEnc) {
        out.cert = "(set)";
        delete out.certEnc;
      }
      if (out.idpCert || out.idpCertEnc) {
        out.idpCert = "(set)";
        delete out.idpCertEnc;
      }
      return out;
    });
  } catch {
    return [];
  }
}

export function readSettings(): AppSettings {
  const rows = getAllSettingsRows();
  if (rows.length === 0) {
    return { ...DEFAULTS };
  }
  return buildAppSettingsFromRows(rows);
}

export function writeSettings(settings: AppSettings): void {
  const now = sqlNow();
  function upsert(key: string, value: string) {
    drizzleDb
      .insert(settingsTable)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value, updatedAt: now },
      })
      .run();
  }
  upsert("whisper_asr_url", settings.whisper_asr_url);
  upsert("transcription_provider", settings.transcription_provider);
  upsert("openai_transcription_url", settings.openai_transcription_url);
  upsert(
    "openai_transcription_api_key",
    settings.openai_transcription_api_key,
  );
  upsert("transcription_model", settings.transcription_model);
  upsert("default_can_transcribe", String(settings.default_can_transcribe));
  upsert("default_can_generate_video", String(settings.default_can_generate_video));
  upsert("default_can_stripe", String(settings.default_can_stripe));
  upsert("llm_provider", settings.llm_provider);
  upsert("ollama_url", settings.ollama_url);
  upsert("openai_api_key", settings.openai_api_key);
  upsert("model", settings.model);
  upsert("registration_enabled", String(settings.registration_enabled));
  upsert("public_feeds_enabled", String(settings.public_feeds_enabled));
  upsert(
    "websub_discovery_enabled",
    String(settings.websub_discovery_enabled),
  );
  upsert("hostname", settings.hostname);
  upsert("websub_hub", settings.websub_hub);
  upsert("final_bitrate_kbps", String(settings.final_bitrate_kbps));
  upsert("final_channels", settings.final_channels);
  upsert("final_format", settings.final_format);
  upsert(
    "loudness_target_lufs",
    settings.loudness_target_lufs != null ? String(settings.loudness_target_lufs) : "",
  );
  upsert("maxmind_account_id", settings.maxmind_account_id);
  upsert("maxmind_license_key", settings.maxmind_license_key);
  upsert(
    "default_max_podcasts",
    settings.default_max_podcasts == null
      ? ""
      : String(settings.default_max_podcasts),
  );
  upsert(
    "default_storage_mb",
    settings.default_storage_mb == null
      ? ""
      : String(settings.default_storage_mb),
  );
  upsert(
    "default_max_episodes",
    settings.default_max_episodes == null
      ? ""
      : String(settings.default_max_episodes),
  );
  upsert(
    "default_max_collaborators",
    settings.default_max_collaborators == null
      ? ""
      : String(settings.default_max_collaborators),
  );
  upsert(
    "default_max_subscriber_tokens",
    settings.default_max_subscriber_tokens == null
      ? ""
      : String(settings.default_max_subscriber_tokens),
  );
  upsert("captcha_provider", settings.captcha_provider);
  upsert("captcha_site_key", settings.captcha_site_key);
  upsert("captcha_secret_key", settings.captcha_secret_key);
  upsert("email_provider", settings.email_provider);
  upsert("email_webhook_url", settings.email_webhook_url ?? "");
  upsert(
    "email_webhook_field_key",
    settings.email_webhook_field_key ?? "content",
  );
  upsert("smtp_host", settings.smtp_host);
  upsert("smtp_port", String(settings.smtp_port));
  upsert("smtp_secure", String(settings.smtp_secure));
  upsert("smtp_user", settings.smtp_user);
  upsert("smtp_password", settings.smtp_password);
  upsert("smtp_from", settings.smtp_from);
  upsert("sendgrid_api_key", settings.sendgrid_api_key);
  upsert("sendgrid_from", settings.sendgrid_from);
  upsert(
    "email_enable_registration_verification",
    String(settings.email_enable_registration_verification),
  );
  upsert(
    "email_enable_welcome_after_verify",
    String(settings.email_enable_welcome_after_verify),
  );
  upsert(
    "email_enable_password_reset",
    String(settings.email_enable_password_reset),
  );
  upsert(
    "email_enable_admin_welcome",
    String(settings.email_enable_admin_welcome),
  );
  upsert("email_enable_new_show", String(settings.email_enable_new_show));
  upsert("email_enable_invite", String(settings.email_enable_invite));
  upsert("email_enable_contact", String(settings.email_enable_contact));
  upsert(
    "email_enable_review_verification",
    String(settings.email_enable_review_verification),
  );
  upsert("reviews_enabled", String(settings.reviews_enabled));
  upsert(
    "reviews_publish_non_verified",
    String(settings.reviews_publish_non_verified),
  );
  upsert("reviews_llm_spam_check", String(settings.reviews_llm_spam_check));
  upsert("welcome_banner", settings.welcome_banner);
  upsert("white_label", settings.white_label);
  upsert("custom_terms", settings.custom_terms);
  upsert("custom_privacy", settings.custom_privacy);
  upsert("dns_provider", settings.dns_provider);
  upsert("dns_provider_api_token_enc", settings.dns_provider_api_token_enc);
  upsert("dns_use_cname", String(settings.dns_use_cname));
  upsert("dns_a_record_ip", settings.dns_a_record_ip ?? "");
  upsert("dns_allow_linking_domain", String(settings.dns_allow_linking_domain));
  upsert("dns_default_allow_domain", String(settings.dns_default_allow_domain));
  upsert("dns_default_allow_domains", settings.dns_default_allow_domains);
  upsert("dns_default_allow_custom_key", String(settings.dns_default_allow_custom_key));
  upsert("dns_default_allow_sub_domain", String(settings.dns_default_allow_sub_domain));
  upsert("dns_default_domain", settings.dns_default_domain);
  upsert("dns_default_enable_cloudflare_proxy", String(settings.dns_default_enable_cloudflare_proxy));
  upsert("gdpr_consent_banner_enabled", String(settings.gdpr_consent_banner_enabled));
  upsert("webrtc_service_url", settings.webrtc_service_url ?? "");
  upsert("webrtc_public_ws_url", settings.webrtc_public_ws_url ?? "");
  upsert("recording_callback_secret", settings.recording_callback_secret ?? "");
  upsert("two_factor_enabled", String(settings.two_factor_enabled));
  upsert("two_factor_methods", settings.two_factor_methods ?? DEFAULTS.two_factor_methods);
  upsert("two_factor_enforced", String(settings.two_factor_enforced));
  upsert("email_signin_disabled", String(settings.email_signin_disabled ?? false));
}

/**
 * Migrate settings from file to database if file exists and database is empty
 * This should be called after database migrations have run
 */
export function migrateSettingsFromFile(): void {
  const path = getSettingsPath();
  if (!existsSync(path)) return;

  try {
    const existing = drizzleDb
      .select({ count: sql<number>`COUNT(*)` })
      .from(settingsTable)
      .get();
    if ((existing?.count ?? 0) > 0) return;

    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const settings: AppSettings = {
      ...DEFAULTS,
      ...parsed,
      model:
        parsed.model ??
        (parsed.llm_provider === "openai"
          ? OPENAI_DEFAULT_MODEL
          : parsed.llm_provider === "ollama"
            ? DEFAULTS.model
            : ""),
      registration_enabled:
        parsed.registration_enabled ?? DEFAULTS.registration_enabled,
      public_feeds_enabled:
        (parsed as Partial<AppSettings>).public_feeds_enabled ??
        DEFAULTS.public_feeds_enabled,
    };

    function upsertSetting(key: string, value: string) {
      const now = sqlNow();
      drizzleDb
        .insert(settingsTable)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value, updatedAt: now },
        })
        .run();
    }

    upsertSetting("whisper_asr_url", settings.whisper_asr_url);
    upsertSetting("llm_provider", settings.llm_provider);
    upsertSetting("ollama_url", settings.ollama_url);
    upsertSetting("openai_api_key", settings.openai_api_key);
    upsertSetting("model", settings.model);
    upsertSetting(
      "registration_enabled",
      String(settings.registration_enabled ?? true),
    );
    upsertSetting(
      "public_feeds_enabled",
      String(settings.public_feeds_enabled ?? true),
    );
    upsertSetting(
      "websub_discovery_enabled",
      String(
        (settings as Partial<AppSettings>).websub_discovery_enabled ?? false,
      ),
    );
    upsertSetting("hostname", settings.hostname ?? "");
    upsertSetting("websub_hub", settings.websub_hub ?? "");
    upsertSetting(
      "final_bitrate_kbps",
      String(settings.final_bitrate_kbps ?? DEFAULTS.final_bitrate_kbps),
    );
    upsertSetting(
      "final_channels",
      settings.final_channels ?? DEFAULTS.final_channels,
    );
    upsertSetting("final_format", settings.final_format ?? DEFAULTS.final_format);
    upsertSetting("maxmind_account_id", settings.maxmind_account_id ?? "");
    upsertSetting("maxmind_license_key", settings.maxmind_license_key ?? "");
    upsertSetting(
      "default_max_podcasts",
      settings.default_max_podcasts == null
        ? ""
        : String(settings.default_max_podcasts),
    );
    upsertSetting(
      "default_storage_mb",
      settings.default_storage_mb == null
        ? ""
        : String(settings.default_storage_mb),
    );
    upsertSetting(
      "default_max_episodes",
      settings.default_max_episodes == null
        ? ""
        : String(settings.default_max_episodes),
    );
    upsertSetting(
      "default_max_collaborators",
      (settings as Partial<AppSettings>).default_max_collaborators == null
        ? ""
        : String((settings as Partial<AppSettings>).default_max_collaborators),
    );
    upsertSetting(
      "default_max_subscriber_tokens",
      (settings as Partial<AppSettings>).default_max_subscriber_tokens == null
        ? ""
        : String(
            (settings as Partial<AppSettings>).default_max_subscriber_tokens ??
              "",
          ),
    );
    upsertSetting(
      "captcha_provider",
      (settings as Partial<AppSettings>).captcha_provider ?? "none",
    );
    upsertSetting(
      "captcha_site_key",
      (settings as Partial<AppSettings>).captcha_site_key ?? "",
    );
    upsertSetting(
      "captcha_secret_key",
      (settings as Partial<AppSettings>).captcha_secret_key ?? "",
    );
    upsertSetting(
      "email_provider",
      (settings as Partial<AppSettings>).email_provider ?? "none",
    );
    upsertSetting(
      "email_webhook_url",
      (settings as Partial<AppSettings>).email_webhook_url ?? "",
    );
    upsertSetting(
      "email_webhook_field_key",
      (settings as Partial<AppSettings>).email_webhook_field_key ?? "content",
    );
    upsertSetting("smtp_host", (settings as Partial<AppSettings>).smtp_host ?? "");
    upsertSetting(
      "smtp_port",
      String((settings as Partial<AppSettings>).smtp_port ?? 587),
    );
    upsertSetting(
      "smtp_secure",
      String((settings as Partial<AppSettings>).smtp_secure ?? true),
    );
    upsertSetting("smtp_user", (settings as Partial<AppSettings>).smtp_user ?? "");
    upsertSetting(
      "smtp_password",
      (settings as Partial<AppSettings>).smtp_password ?? "",
    );
    upsertSetting("smtp_from", (settings as Partial<AppSettings>).smtp_from ?? "");
    upsertSetting(
      "sendgrid_api_key",
      (settings as Partial<AppSettings>).sendgrid_api_key ?? "",
    );
    upsertSetting(
      "sendgrid_from",
      (settings as Partial<AppSettings>).sendgrid_from ?? "",
    );
    upsertSetting(
      "email_enable_registration_verification",
      String(
        (settings as Partial<AppSettings>)
          .email_enable_registration_verification ?? true,
      ),
    );
    upsertSetting(
      "email_enable_welcome_after_verify",
      String(
        (settings as Partial<AppSettings>).email_enable_welcome_after_verify ??
          true,
      ),
    );
    upsertSetting(
      "email_enable_password_reset",
      String(
        (settings as Partial<AppSettings>).email_enable_password_reset ?? true,
      ),
    );
    upsertSetting(
      "email_enable_admin_welcome",
      String(
        (settings as Partial<AppSettings>).email_enable_admin_welcome ?? true,
      ),
    );
    upsertSetting(
      "email_enable_new_show",
      String((settings as Partial<AppSettings>).email_enable_new_show ?? true),
    );
    upsertSetting(
      "email_enable_invite",
      String((settings as Partial<AppSettings>).email_enable_invite ?? true),
    );
    upsertSetting(
      "email_enable_contact",
      String((settings as Partial<AppSettings>).email_enable_contact ?? true),
    );
    upsertSetting(
      "email_signin_disabled",
      String((settings as Partial<AppSettings>).email_signin_disabled ?? false),
    );

    console.log("Migrated settings from file to database");
  } catch (err) {
    if ((err as Error).message?.includes("no such table")) {
      return;
    }
    console.error("Failed to migrate settings from file:", err);
  }
}

/**
 * Populate WebRTC settings in DB from env vars when WebRTC is enabled via env (Docker/PM2).
 * Only writes when env has values and DB has empty webrtc settings, so the Settings page displays them.
 */
export function migrateWebRtcFromEnv(): void {
  const envService = WEBRTC_SERVICE_URL;
  const envPublic = WEBRTC_PUBLIC_WS_URL;
  if (!envService || !envPublic) return;

  try {
    const rows = drizzleDb
      .select({ key: settingsTable.key, value: settingsTable.value })
      .from(settingsTable)
      .where(
        inArray(settingsTable.key, [
          "webrtc_service_url",
          "webrtc_public_ws_url",
        ]),
      )
      .all() as Array<{ key: string; value: string }>;
    const current: Record<string, string> = {};
    for (const row of rows) current[row.key] = row.value ?? "";

    const needsService = !(current.webrtc_service_url ?? "").trim();
    const needsPublic = !(current.webrtc_public_ws_url ?? "").trim();
    if (!needsService && !needsPublic) return;

    const now = sqlNow();
    if (needsService) {
      drizzleDb
        .insert(settingsTable)
        .values({
          key: "webrtc_service_url",
          value: envService,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: envService, updatedAt: now },
        })
        .run();
    }
    if (needsPublic) {
      drizzleDb
        .insert(settingsTable)
        .values({
          key: "webrtc_public_ws_url",
          value: envPublic,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: envPublic, updatedAt: now },
        })
        .run();
    }
    console.log("Migrated WebRTC settings from environment to database");
  } catch (err) {
    if ((err as Error).message?.includes("no such table")) return;
    console.warn("Could not migrate WebRTC settings from env:", err);
  }
}
