import type { FastifyInstance } from "fastify";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import nodemailer from "nodemailer";
import { getDataDir } from "../../services/paths.js";
import { requireAdmin } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { normalizeHostname } from "../../utils/url.js";
import {
  FFMPEG_PATH,
  FFPROBE_PATH,
  AUDIOWAVEFORM_PATH,
  OPENAI_MODELS_URL,
  SENDGRID_SCOPES_URL,
  DNS_SECRETS_AAD,
} from "../../config.js";
import {
  runGeoIPUpdate,
  validateMaxMindCredentials,
} from "../../services/geoipupdate.js";
import {
  checkGeoLiteDatabases,
  refreshGeoLiteReaders,
} from "../../services/geolocation.js";
import { checkCommand } from "../../utils/commands.js";
import {
  settingsPatchBodySchema,
  settingsTestLlmBodySchema,
  settingsTestWhisperBodySchema,
  settingsTestTranscriptionOpenaiBodySchema,
  settingsTestSmtpBodySchema,
  settingsTestSendgridBodySchema,
  settingsGeoliteTestBodySchema,
} from "@harborfm/shared";
import {
  encryptSecret,
  isEncryptedSecret,
} from "../../services/secrets.js";

/** Whitelist of commands the server may use. Keys are display names; value is path + args for presence check. */
const COMMANDS_WHITELIST: Record<string, { path: string; args: string[] }> = {
  ffmpeg: { path: FFMPEG_PATH, args: ["-version"] },
  ffprobe: { path: FFPROBE_PATH, args: ["-version"] },
  audiowaveform: { path: AUDIOWAVEFORM_PATH, args: ["--version"] },
  geoipupdate: { path: "geoipupdate", args: ["-V"] },
  smbclient: { path: "smbclient", args: ["--version"] },
};

const SETTINGS_FILENAME = "settings.json";

function validateOllamaBaseUrl(input: string): string {
  const raw = (input || "").trim() || "http://localhost:11434";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid Ollama URL");
  }

  // Allow only http/https schemes
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ollama URL must use http or https");
  }

  // Basic safeguard: disallow URLs without a hostname
  if (!url.hostname) {
    throw new Error("Ollama URL must include a hostname");
  }

  // Normalize by removing any trailing slash from pathname
  const normalized = new URL(url.toString());
  normalized.pathname = normalizeHostname(normalized.pathname);

  return normalized.toString();
}

export interface AppSettings {
  whisper_asr_url: string;
  transcription_provider: "none" | "self_hosted" | "openai";
  openai_transcription_url: string;
  openai_transcription_api_key: string;
  transcription_model: string;
  default_can_transcribe: boolean;
  llm_provider: "none" | "ollama" | "openai";
  ollama_url: string;
  openai_api_key: string;
  model: string;
  registration_enabled: boolean;
  public_feeds_enabled: boolean;
  /** When true, feed XML can include WebSub hub link; hub URL is in websub_hub. */
  websub_discovery_enabled: boolean;
  hostname: string;
  /** WebSub hub URL (e.g. https://pubsubhubbub.appspot.com/). Used when websub_discovery_enabled is true. */
  websub_hub: string;
  final_bitrate_kbps: number;
  final_channels: "mono" | "stereo";
  final_format: "mp3" | "m4a";
  maxmind_account_id: string;
  maxmind_license_key: string;
  /** Default max podcasts for new users. null/empty = no limit. */
  default_max_podcasts: number | null;
  /** Default storage space in MB for new users. null/empty = no limit. */
  default_storage_mb: number | null;
  /** Default max episodes for new users. null/empty = no limit. */
  default_max_episodes: number | null;
  /** Default max collaborators per user (per podcast). null/empty = no limit. */
  default_max_collaborators: number | null;
  /** Default max subscriber tokens per podcast. null/empty = no limit. */
  default_max_subscriber_tokens: number | null;
  /** CAPTCHA provider for sign-in and registration. */
  captcha_provider: "none" | "recaptcha_v2" | "recaptcha_v3" | "hcaptcha";
  /** Site key for the selected CAPTCHA provider. */
  captcha_site_key: string;
  /** Secret key for the selected CAPTCHA provider. */
  captcha_secret_key: string;
  /** Email provider for sending mail (e.g. notifications). */
  email_provider: "none" | "smtp" | "sendgrid";
  /** SMTP host. */
  smtp_host: string;
  /** SMTP port (e.g. 587). */
  smtp_port: number;
  /** SMTP use TLS. */
  smtp_secure: boolean;
  /** SMTP username. */
  smtp_user: string;
  /** SMTP password. */
  smtp_password: string;
  /** From address for SMTP. */
  smtp_from: string;
  /** SendGrid API key. */
  sendgrid_api_key: string;
  /** From address for SendGrid. */
  sendgrid_from: string;
  /** When true and email is configured, send verification email on self-registration and require verification. */
  email_enable_registration_verification: boolean;
  /** When true and email is configured, send welcome email after user verifies. */
  email_enable_welcome_after_verify: boolean;
  /** When true and email is configured, allow password reset emails. */
  email_enable_password_reset: boolean;
  /** When true and email is configured, send set-password welcome when admin creates a user. */
  email_enable_admin_welcome: boolean;
  /** When true and email is configured, send "new show" email to creator. */
  email_enable_new_show: boolean;
  /** When true and email is configured, allow invite-to-platform emails. */
  email_enable_invite: boolean;
  /** When true and email is configured, forward contact form submissions by email. */
  email_enable_contact: boolean;
  /** Optional message shown above the sign-in form. Newlines are preserved. */
  welcome_banner: string;
  /** Custom Terms of Service (Markdown). When set, /terms shows this instead of default. */
  custom_terms: string;
  /** Custom Privacy Policy (Markdown). When set, /privacy shows this instead of default. */
  custom_privacy: string;
  /** DNS provider: none | cloudflare. */
  dns_provider: "none" | "cloudflare";
  /** Encrypted Cloudflare API token; do not send to client. */
  dns_provider_api_token_enc: string;
  /** Use CNAME for DNS target (when false, use A record with dns_a_record_ip if set). */
  dns_use_cname: boolean;
  /** Server IP for A record when dns_use_cname is false. */
  dns_a_record_ip: string;
  /** Allow linking domain (default allow linking domain). */
  dns_allow_linking_domain: boolean;
  /** Default allow domain toggle. */
  dns_default_allow_domain: boolean;
  /** Default allow domains (JSON string array). */
  dns_default_allow_domains: string;
  /** Default allow custom key. */
  dns_default_allow_custom_key: boolean;
  /** Default allow sub-domain. */
  dns_default_allow_sub_domain: boolean;
  /** Default domain (e.g. example.com). */
  dns_default_domain: string;
  /** Default enable Cloudflare proxy. */
  dns_default_enable_cloudflare_proxy: boolean;
}

const OPENAI_TRANSCRIPTION_DEFAULT_URL =
  "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIPTION_DEFAULT_MODEL = "whisper-1";

const DEFAULTS: AppSettings = {
  whisper_asr_url: "http://whisper:9000",
  transcription_provider: "none",
  openai_transcription_url: OPENAI_TRANSCRIPTION_DEFAULT_URL,
  openai_transcription_api_key: "",
  transcription_model: TRANSCRIPTION_DEFAULT_MODEL,
  default_can_transcribe: true,
  llm_provider: "none",
  ollama_url: "http://localhost:11434",
  openai_api_key: "",
  model: "llama3.2:latest",
  registration_enabled: true,
  public_feeds_enabled: true,
  websub_discovery_enabled: false,
  hostname: "",
  websub_hub: "",
  final_bitrate_kbps: 128,
  final_channels: "mono",
  final_format: "mp3",
  maxmind_account_id: "",
  maxmind_license_key: "",
  default_max_podcasts: null,
  default_storage_mb: null,
  default_max_episodes: null,
  default_max_collaborators: null,
  default_max_subscriber_tokens: null,
  captcha_provider: "none",
  captcha_site_key: "",
  captcha_secret_key: "",
  email_provider: "none",
  smtp_host: "",
  smtp_port: 587,
  smtp_secure: true,
  smtp_user: "",
  smtp_password: "",
  smtp_from: "",
  sendgrid_api_key: "",
  sendgrid_from: "",
  email_enable_registration_verification: true,
  email_enable_welcome_after_verify: true,
  email_enable_password_reset: true,
  email_enable_admin_welcome: true,
  email_enable_new_show: true,
  email_enable_invite: true,
  email_enable_contact: true,
  welcome_banner: "",
  custom_terms: "",
  custom_privacy: "",
  dns_provider: "none",
  dns_provider_api_token_enc: "",
  dns_use_cname: true,
  dns_a_record_ip: "",
  dns_allow_linking_domain: false,
  dns_default_allow_domain: false,
  dns_default_allow_domains: "[]",
  dns_default_allow_custom_key: false,
  dns_default_allow_sub_domain: false,
  dns_default_domain: "",
  dns_default_enable_cloudflare_proxy: false,
};

const OPENAI_DEFAULT_MODEL = "gpt5-mini";

function getSettingsPath(): string {
  return join(getDataDir(), SETTINGS_FILENAME);
}

/**
 * Migrate settings from file to database if file exists and database is empty
 * This should be called after database migrations have run
 */
export function migrateSettingsFromFile(): void {
  const path = getSettingsPath();
  if (!existsSync(path)) return;

  try {
    // Check if database already has settings
    const existing = db
      .prepare("SELECT COUNT(*) as count FROM settings")
      .get() as { count: number };
    if (existing.count > 0) return;

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

    // Write to database
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    );
    stmt.run("whisper_asr_url", settings.whisper_asr_url);
    stmt.run("llm_provider", settings.llm_provider);
    stmt.run("ollama_url", settings.ollama_url);
    stmt.run("openai_api_key", settings.openai_api_key);
    stmt.run("model", settings.model);
    stmt.run(
      "registration_enabled",
      String(settings.registration_enabled ?? true),
    );
    stmt.run(
      "public_feeds_enabled",
      String(settings.public_feeds_enabled ?? true),
    );
    stmt.run(
      "websub_discovery_enabled",
      String(
        (settings as Partial<AppSettings>).websub_discovery_enabled ?? false,
      ),
    );
    stmt.run("hostname", settings.hostname ?? "");
    stmt.run("websub_hub", settings.websub_hub ?? "");
    stmt.run(
      "final_bitrate_kbps",
      String(settings.final_bitrate_kbps ?? DEFAULTS.final_bitrate_kbps),
    );
    stmt.run(
      "final_channels",
      settings.final_channels ?? DEFAULTS.final_channels,
    );
    stmt.run("final_format", settings.final_format ?? DEFAULTS.final_format);
    stmt.run("maxmind_account_id", settings.maxmind_account_id ?? "");
    stmt.run("maxmind_license_key", settings.maxmind_license_key ?? "");
    stmt.run(
      "default_max_podcasts",
      settings.default_max_podcasts == null
        ? ""
        : String(settings.default_max_podcasts),
    );
    stmt.run(
      "default_storage_mb",
      settings.default_storage_mb == null
        ? ""
        : String(settings.default_storage_mb),
    );
    stmt.run(
      "default_max_episodes",
      settings.default_max_episodes == null
        ? ""
        : String(settings.default_max_episodes),
    );
    stmt.run(
      "default_max_collaborators",
      (settings as Partial<AppSettings>).default_max_collaborators == null
        ? ""
        : String((settings as Partial<AppSettings>).default_max_collaborators),
    );
    stmt.run(
      "default_max_subscriber_tokens",
      (settings as Partial<AppSettings>).default_max_subscriber_tokens == null
        ? ""
        : String(
            (settings as Partial<AppSettings>).default_max_subscriber_tokens ??
              "",
          ),
    );
    stmt.run(
      "captcha_provider",
      (settings as Partial<AppSettings>).captcha_provider ?? "none",
    );
    stmt.run(
      "captcha_site_key",
      (settings as Partial<AppSettings>).captcha_site_key ?? "",
    );
    stmt.run(
      "captcha_secret_key",
      (settings as Partial<AppSettings>).captcha_secret_key ?? "",
    );
    stmt.run(
      "email_provider",
      (settings as Partial<AppSettings>).email_provider ?? "none",
    );
    stmt.run("smtp_host", (settings as Partial<AppSettings>).smtp_host ?? "");
    stmt.run(
      "smtp_port",
      String((settings as Partial<AppSettings>).smtp_port ?? 587),
    );
    stmt.run(
      "smtp_secure",
      String((settings as Partial<AppSettings>).smtp_secure ?? true),
    );
    stmt.run("smtp_user", (settings as Partial<AppSettings>).smtp_user ?? "");
    stmt.run(
      "smtp_password",
      (settings as Partial<AppSettings>).smtp_password ?? "",
    );
    stmt.run("smtp_from", (settings as Partial<AppSettings>).smtp_from ?? "");
    stmt.run(
      "sendgrid_api_key",
      (settings as Partial<AppSettings>).sendgrid_api_key ?? "",
    );
    stmt.run(
      "sendgrid_from",
      (settings as Partial<AppSettings>).sendgrid_from ?? "",
    );
    stmt.run(
      "email_enable_registration_verification",
      String(
        (settings as Partial<AppSettings>)
          .email_enable_registration_verification ?? true,
      ),
    );
    stmt.run(
      "email_enable_welcome_after_verify",
      String(
        (settings as Partial<AppSettings>).email_enable_welcome_after_verify ??
          true,
      ),
    );
    stmt.run(
      "email_enable_password_reset",
      String(
        (settings as Partial<AppSettings>).email_enable_password_reset ?? true,
      ),
    );
    stmt.run(
      "email_enable_admin_welcome",
      String(
        (settings as Partial<AppSettings>).email_enable_admin_welcome ?? true,
      ),
    );
    stmt.run(
      "email_enable_new_show",
      String((settings as Partial<AppSettings>).email_enable_new_show ?? true),
    );
    stmt.run(
      "email_enable_invite",
      String((settings as Partial<AppSettings>).email_enable_invite ?? true),
    );
    stmt.run(
      "email_enable_contact",
      String((settings as Partial<AppSettings>).email_enable_contact ?? true),
    );

    console.log("Migrated settings from file to database");
  } catch (err) {
    // Table might not exist yet, that's okay
    if ((err as Error).message?.includes("no such table")) {
      return;
    }
    console.error("Failed to migrate settings from file:", err);
  }
}

export function readSettings(): AppSettings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;

  if (rows.length === 0) {
    // No settings in database, return defaults
    return { ...DEFAULTS };
  }

  const settings: Partial<AppSettings> = {};
  for (const row of rows) {
    if (row.key === "whisper_asr_url") settings.whisper_asr_url = row.value;
    else if (row.key === "transcription_provider") {
      const v = row.value as AppSettings["transcription_provider"];
      if (v === "self_hosted" || v === "openai" || v === "none")
        settings.transcription_provider = v;
    } else if (row.key === "openai_transcription_url")
      settings.openai_transcription_url = row.value;
    else if (row.key === "openai_transcription_api_key")
      settings.openai_transcription_api_key = row.value;
    else if (row.key === "transcription_model")
      settings.transcription_model = row.value;
    else if (row.key === "default_can_transcribe")
      settings.default_can_transcribe = row.value === "true";
    else if (row.key === "llm_provider")
      settings.llm_provider = row.value as AppSettings["llm_provider"];
    else if (row.key === "ollama_url") settings.ollama_url = row.value;
    else if (row.key === "openai_api_key") settings.openai_api_key = row.value;
    else if (row.key === "model") settings.model = row.value;
    else if (row.key === "registration_enabled")
      settings.registration_enabled = row.value === "true";
    else if (row.key === "public_feeds_enabled")
      settings.public_feeds_enabled = row.value === "true";
    else if (row.key === "websub_discovery_enabled")
      settings.websub_discovery_enabled = row.value === "true";
    else if (row.key === "hostname") settings.hostname = row.value;
    else if (row.key === "websub_hub") settings.websub_hub = row.value;
    else if (row.key === "final_bitrate_kbps") {
      const v = Number(row.value);
      if (!Number.isNaN(v)) settings.final_bitrate_kbps = v;
    } else if (row.key === "final_channels")
      settings.final_channels = row.value as AppSettings["final_channels"];
    else if (row.key === "final_format")
      settings.final_format = row.value as AppSettings["final_format"];
    else if (row.key === "maxmind_account_id")
      settings.maxmind_account_id = row.value;
    else if (row.key === "maxmind_license_key")
      settings.maxmind_license_key = row.value;
    else if (row.key === "default_max_podcasts") {
      const v = row.value.trim();
      settings.default_max_podcasts =
        v === "" ? null : Number(row.value) || null;
    } else if (row.key === "default_storage_mb") {
      const v = row.value.trim();
      settings.default_storage_mb = v === "" ? null : Number(row.value) || null;
    } else if (row.key === "default_max_episodes") {
      const v = row.value.trim();
      settings.default_max_episodes =
        v === "" ? null : Number(row.value) || null;
    } else if (row.key === "default_max_collaborators") {
      const v = row.value.trim();
      settings.default_max_collaborators =
        v === "" ? null : Number(row.value) || null;
    } else if (row.key === "default_max_subscriber_tokens") {
      const v = row.value.trim();
      settings.default_max_subscriber_tokens =
        v === "" ? null : Number(row.value) || null;
    } else if (row.key === "captcha_provider") {
      const v = row.value as AppSettings["captcha_provider"];
      if (
        v === "recaptcha_v2" ||
        v === "recaptcha_v3" ||
        v === "hcaptcha" ||
        v === "none"
      )
        settings.captcha_provider = v;
    } else if (row.key === "captcha_site_key")
      settings.captcha_site_key = row.value;
    else if (row.key === "captcha_secret_key")
      settings.captcha_secret_key = row.value;
    else if (row.key === "email_provider") {
      const v = row.value as AppSettings["email_provider"];
      if (v === "smtp" || v === "sendgrid" || v === "none")
        settings.email_provider = v;
    } else if (row.key === "smtp_host") settings.smtp_host = row.value;
    else if (row.key === "smtp_port") {
      const v = Number(row.value);
      if (!Number.isNaN(v)) settings.smtp_port = v;
    } else if (row.key === "smtp_secure")
      settings.smtp_secure = row.value === "true";
    else if (row.key === "smtp_user") settings.smtp_user = row.value;
    else if (row.key === "smtp_password") settings.smtp_password = row.value;
    else if (row.key === "smtp_from") settings.smtp_from = row.value;
    else if (row.key === "sendgrid_api_key")
      settings.sendgrid_api_key = row.value;
    else if (row.key === "sendgrid_from") settings.sendgrid_from = row.value;
    else if (row.key === "email_enable_registration_verification")
      settings.email_enable_registration_verification = row.value === "true";
    else if (row.key === "email_enable_welcome_after_verify")
      settings.email_enable_welcome_after_verify = row.value === "true";
    else if (row.key === "email_enable_password_reset")
      settings.email_enable_password_reset = row.value === "true";
    else if (row.key === "email_enable_admin_welcome")
      settings.email_enable_admin_welcome = row.value === "true";
    else if (row.key === "email_enable_new_show")
      settings.email_enable_new_show = row.value === "true";
    else if (row.key === "email_enable_invite")
      settings.email_enable_invite = row.value === "true";
    else if (row.key === "email_enable_contact")
      settings.email_enable_contact = row.value === "true";
    else if (row.key === "welcome_banner") settings.welcome_banner = row.value;
    else if (row.key === "custom_terms") settings.custom_terms = row.value;
    else if (row.key === "custom_privacy") settings.custom_privacy = row.value;
    else if (row.key === "dns_provider") {
      const v = row.value as AppSettings["dns_provider"];
      if (v === "none" || v === "cloudflare")
        (settings as Partial<AppSettings>).dns_provider = v;
    }     else if (row.key === "dns_provider_api_token_enc")
      (settings as Partial<AppSettings>).dns_provider_api_token_enc = row.value;
    else if (row.key === "dns_use_cname")
      (settings as Partial<AppSettings>).dns_use_cname = row.value === "true";
    else if (row.key === "dns_a_record_ip")
      (settings as Partial<AppSettings>).dns_a_record_ip = row.value;
    else if (row.key === "dns_allow_linking_domain")
      (settings as Partial<AppSettings>).dns_allow_linking_domain =
        row.value === "true";
    else if (row.key === "dns_default_allow_domain")
      (settings as Partial<AppSettings>).dns_default_allow_domain =
        row.value === "true";
    else if (row.key === "dns_default_allow_domains")
      (settings as Partial<AppSettings>).dns_default_allow_domains = row.value;
    else if (row.key === "dns_default_allow_custom_key")
      (settings as Partial<AppSettings>).dns_default_allow_custom_key =
        row.value === "true";
    else if (row.key === "dns_default_allow_sub_domain")
      (settings as Partial<AppSettings>).dns_default_allow_sub_domain =
        row.value === "true";
    else if (row.key === "dns_default_domain")
      (settings as Partial<AppSettings>).dns_default_domain = row.value;
    else if (row.key === "dns_default_enable_cloudflare_proxy")
      (settings as Partial<AppSettings>).dns_default_enable_cloudflare_proxy =
        row.value === "true";
  }

  return {
    ...DEFAULTS,
    ...settings,
    whisper_asr_url: settings.whisper_asr_url ?? DEFAULTS.whisper_asr_url,
    transcription_provider:
      settings.transcription_provider ?? DEFAULTS.transcription_provider,
    openai_transcription_url:
      settings.openai_transcription_url ?? DEFAULTS.openai_transcription_url,
    openai_transcription_api_key:
      settings.openai_transcription_api_key ??
      DEFAULTS.openai_transcription_api_key,
    transcription_model:
      settings.transcription_model ?? DEFAULTS.transcription_model,
    default_can_transcribe:
      settings.default_can_transcribe ?? DEFAULTS.default_can_transcribe,
    model:
      settings.model ??
      (settings.llm_provider === "openai"
        ? OPENAI_DEFAULT_MODEL
        : settings.llm_provider === "ollama"
          ? DEFAULTS.model
          : ""),
    registration_enabled:
      settings.registration_enabled ?? DEFAULTS.registration_enabled,
    public_feeds_enabled:
      settings.public_feeds_enabled ?? DEFAULTS.public_feeds_enabled,
    websub_discovery_enabled:
      settings.websub_discovery_enabled ?? DEFAULTS.websub_discovery_enabled,
    hostname: settings.hostname ?? DEFAULTS.hostname,
    websub_hub: settings.websub_hub ?? DEFAULTS.websub_hub,
    maxmind_account_id:
      settings.maxmind_account_id ?? DEFAULTS.maxmind_account_id,
    maxmind_license_key:
      settings.maxmind_license_key ?? DEFAULTS.maxmind_license_key,
    default_max_podcasts:
      settings.default_max_podcasts ?? DEFAULTS.default_max_podcasts,
    default_storage_mb:
      settings.default_storage_mb ?? DEFAULTS.default_storage_mb,
    default_max_episodes:
      settings.default_max_episodes ?? DEFAULTS.default_max_episodes,
    default_max_collaborators:
      settings.default_max_collaborators ?? DEFAULTS.default_max_collaborators,
    default_max_subscriber_tokens:
      settings.default_max_subscriber_tokens ??
      DEFAULTS.default_max_subscriber_tokens,
    captcha_provider: settings.captcha_provider ?? DEFAULTS.captcha_provider,
    captcha_site_key: settings.captcha_site_key ?? DEFAULTS.captcha_site_key,
    captcha_secret_key:
      settings.captcha_secret_key ?? DEFAULTS.captcha_secret_key,
    email_provider: settings.email_provider ?? DEFAULTS.email_provider,
    smtp_host: settings.smtp_host ?? DEFAULTS.smtp_host,
    smtp_port: settings.smtp_port ?? DEFAULTS.smtp_port,
    smtp_secure: settings.smtp_secure ?? DEFAULTS.smtp_secure,
    smtp_user: settings.smtp_user ?? DEFAULTS.smtp_user,
    smtp_password: settings.smtp_password ?? DEFAULTS.smtp_password,
    smtp_from: settings.smtp_from ?? DEFAULTS.smtp_from,
    sendgrid_api_key: settings.sendgrid_api_key ?? DEFAULTS.sendgrid_api_key,
    sendgrid_from: settings.sendgrid_from ?? DEFAULTS.sendgrid_from,
    email_enable_registration_verification:
      settings.email_enable_registration_verification ??
      DEFAULTS.email_enable_registration_verification,
    email_enable_welcome_after_verify:
      settings.email_enable_welcome_after_verify ??
      DEFAULTS.email_enable_welcome_after_verify,
    email_enable_password_reset:
      settings.email_enable_password_reset ??
      DEFAULTS.email_enable_password_reset,
    email_enable_admin_welcome:
      settings.email_enable_admin_welcome ??
      DEFAULTS.email_enable_admin_welcome,
    email_enable_new_show:
      settings.email_enable_new_show ?? DEFAULTS.email_enable_new_show,
    email_enable_invite:
      settings.email_enable_invite ?? DEFAULTS.email_enable_invite,
    email_enable_contact:
      settings.email_enable_contact ?? DEFAULTS.email_enable_contact,
    welcome_banner: settings.welcome_banner ?? DEFAULTS.welcome_banner,
    custom_terms: settings.custom_terms ?? DEFAULTS.custom_terms,
    custom_privacy: settings.custom_privacy ?? DEFAULTS.custom_privacy,
    dns_provider: settings.dns_provider ?? DEFAULTS.dns_provider,
    dns_provider_api_token_enc:
      settings.dns_provider_api_token_enc ??
      DEFAULTS.dns_provider_api_token_enc,
    dns_use_cname: settings.dns_use_cname ?? DEFAULTS.dns_use_cname,
    dns_a_record_ip: settings.dns_a_record_ip ?? DEFAULTS.dns_a_record_ip,
    dns_allow_linking_domain:
      settings.dns_allow_linking_domain ?? DEFAULTS.dns_allow_linking_domain,
    dns_default_allow_domain:
      settings.dns_default_allow_domain ?? DEFAULTS.dns_default_allow_domain,
    dns_default_allow_domains:
      settings.dns_default_allow_domains ?? DEFAULTS.dns_default_allow_domains,
    dns_default_allow_custom_key:
      settings.dns_default_allow_custom_key ??
      DEFAULTS.dns_default_allow_custom_key,
    dns_default_allow_sub_domain:
      settings.dns_default_allow_sub_domain ??
      DEFAULTS.dns_default_allow_sub_domain,
    dns_default_domain:
      settings.dns_default_domain ?? DEFAULTS.dns_default_domain,
    dns_default_enable_cloudflare_proxy:
      settings.dns_default_enable_cloudflare_proxy ??
      DEFAULTS.dns_default_enable_cloudflare_proxy,
  };
}

function writeSettings(settings: AppSettings): void {
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  );
  stmt.run("whisper_asr_url", settings.whisper_asr_url);
  stmt.run("transcription_provider", settings.transcription_provider);
  stmt.run("openai_transcription_url", settings.openai_transcription_url);
  stmt.run(
    "openai_transcription_api_key",
    settings.openai_transcription_api_key,
  );
  stmt.run("transcription_model", settings.transcription_model);
  stmt.run("default_can_transcribe", String(settings.default_can_transcribe));
  stmt.run("llm_provider", settings.llm_provider);
  stmt.run("ollama_url", settings.ollama_url);
  stmt.run("openai_api_key", settings.openai_api_key);
  stmt.run("model", settings.model);
  stmt.run("registration_enabled", String(settings.registration_enabled));
  stmt.run("public_feeds_enabled", String(settings.public_feeds_enabled));
  stmt.run(
    "websub_discovery_enabled",
    String(settings.websub_discovery_enabled),
  );
  stmt.run("hostname", settings.hostname);
  stmt.run("websub_hub", settings.websub_hub);
  stmt.run("final_bitrate_kbps", String(settings.final_bitrate_kbps));
  stmt.run("final_channels", settings.final_channels);
  stmt.run("final_format", settings.final_format);
  stmt.run("maxmind_account_id", settings.maxmind_account_id);
  stmt.run("maxmind_license_key", settings.maxmind_license_key);
  stmt.run(
    "default_max_podcasts",
    settings.default_max_podcasts == null
      ? ""
      : String(settings.default_max_podcasts),
  );
  stmt.run(
    "default_storage_mb",
    settings.default_storage_mb == null
      ? ""
      : String(settings.default_storage_mb),
  );
  stmt.run(
    "default_max_episodes",
    settings.default_max_episodes == null
      ? ""
      : String(settings.default_max_episodes),
  );
  stmt.run(
    "default_max_collaborators",
    settings.default_max_collaborators == null
      ? ""
      : String(settings.default_max_collaborators),
  );
  stmt.run(
    "default_max_subscriber_tokens",
    settings.default_max_subscriber_tokens == null
      ? ""
      : String(settings.default_max_subscriber_tokens),
  );
  stmt.run("captcha_provider", settings.captcha_provider);
  stmt.run("captcha_site_key", settings.captcha_site_key);
  stmt.run("captcha_secret_key", settings.captcha_secret_key);
  stmt.run("email_provider", settings.email_provider);
  stmt.run("smtp_host", settings.smtp_host);
  stmt.run("smtp_port", String(settings.smtp_port));
  stmt.run("smtp_secure", String(settings.smtp_secure));
  stmt.run("smtp_user", settings.smtp_user);
  stmt.run("smtp_password", settings.smtp_password);
  stmt.run("smtp_from", settings.smtp_from);
  stmt.run("sendgrid_api_key", settings.sendgrid_api_key);
  stmt.run("sendgrid_from", settings.sendgrid_from);
  stmt.run(
    "email_enable_registration_verification",
    String(settings.email_enable_registration_verification),
  );
  stmt.run(
    "email_enable_welcome_after_verify",
    String(settings.email_enable_welcome_after_verify),
  );
  stmt.run(
    "email_enable_password_reset",
    String(settings.email_enable_password_reset),
  );
  stmt.run(
    "email_enable_admin_welcome",
    String(settings.email_enable_admin_welcome),
  );
  stmt.run("email_enable_new_show", String(settings.email_enable_new_show));
  stmt.run("email_enable_invite", String(settings.email_enable_invite));
  stmt.run("email_enable_contact", String(settings.email_enable_contact));
  stmt.run("welcome_banner", settings.welcome_banner);
  stmt.run("custom_terms", settings.custom_terms);
  stmt.run("custom_privacy", settings.custom_privacy);
  stmt.run("dns_provider", settings.dns_provider);
  stmt.run("dns_provider_api_token_enc", settings.dns_provider_api_token_enc);
  stmt.run("dns_use_cname", String(settings.dns_use_cname));
  stmt.run("dns_a_record_ip", settings.dns_a_record_ip ?? "");
  stmt.run("dns_allow_linking_domain", String(settings.dns_allow_linking_domain));
  stmt.run("dns_default_allow_domain", String(settings.dns_default_allow_domain));
  stmt.run("dns_default_allow_domains", settings.dns_default_allow_domains);
  stmt.run("dns_default_allow_custom_key", String(settings.dns_default_allow_custom_key));
  stmt.run("dns_default_allow_sub_domain", String(settings.dns_default_allow_sub_domain));
  stmt.run("dns_default_domain", settings.dns_default_domain);
  stmt.run("dns_default_enable_cloudflare_proxy", String(settings.dns_default_enable_cloudflare_proxy));
}

/** Whether a transcription provider is configured and usable. */
export function isTranscriptionProviderConfigured(
  settings: AppSettings,
): boolean {
  if (settings.transcription_provider === "self_hosted") {
    return Boolean(settings.whisper_asr_url?.trim());
  }
  if (settings.transcription_provider === "openai") {
    return Boolean(settings.openai_transcription_api_key?.trim());
  }
  return false;
}

/** Redact API keys from error messages before sending to client. */
export function redactError(msg: string): string {
  return msg.replace(/sk-[a-zA-Z0-9._-]+/gi, "[REDACTED]");
}

const SMTP_TEST_TIMEOUT_MS = 15_000;

/**
 * Verify SMTP credentials by connecting, optionally upgrading to TLS via STARTTLS, and authenticating.
 * Does not send any email. Uses Nodemailer for protocol handling.
 */
async function verifySmtpCredentials(options: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { host, port, secure, user, password } = options;
  if (!host?.trim() || !user?.trim() || !password) {
    return { ok: false, error: "Host, username, and password are required" };
  }

  const transporter = nodemailer.createTransport({
    host: host.trim(),
    port,
    secure: port === 465 ? secure : false,
    auth: { user: user.trim(), pass: password },
    connectionTimeout: SMTP_TEST_TIMEOUT_MS,
    greetingTimeout: SMTP_TEST_TIMEOUT_MS,
  });

  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get(
    "/settings",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Get settings",
        description: "Returns app settings (secrets redacted). Admin only.",
        response: { 200: { description: "Settings object" } },
      },
    },
    async () => {
      const settings = readSettings();
      return {
        ...settings,
        openai_api_key: settings.openai_api_key ? "(set)" : "",
        openai_transcription_api_key: settings.openai_transcription_api_key
          ? "(set)"
          : "",
        maxmind_license_key: settings.maxmind_license_key ? "(set)" : "",
        captcha_secret_key: settings.captcha_secret_key ? "(set)" : "",
        smtp_password: settings.smtp_password ? "(set)" : "",
        sendgrid_api_key: settings.sendgrid_api_key ? "(set)" : "",
        custom_terms: settings.custom_terms ?? "",
        custom_privacy: settings.custom_privacy ?? "",
        dns_provider_api_token_enc: "", // never send to client
        dns_provider_api_token_set: Boolean(
          settings.dns_provider_api_token_enc &&
            isEncryptedSecret(settings.dns_provider_api_token_enc),
        ),
      };
    },
  );

  app.get(
    "/settings/commands",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Check required commands",
        description:
          "Returns whether each whitelisted command (ffmpeg, ffprobe, audiowaveform, geoipupdate, smbclient) is present. Admin only.",
        response: {
          200: {
            type: "object",
            properties: {
              commands: {
                type: "object",
                additionalProperties: { type: "boolean" },
              },
            },
            required: ["commands"],
          },
        },
      },
    },
    async (_request, reply) => {
      const commands: Record<string, boolean> = {};
      await Promise.all(
        Object.entries(COMMANDS_WHITELIST).map(
          async ([name, { path, args }]) => {
            commands[name] = await checkCommand(path, args);
          },
        ),
      );
      return reply.send({ commands });
    },
  );

  app.patch(
    "/settings",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Update settings",
        description:
          "Update app settings. Admin only. Use (set) for existing secrets to leave unchanged.",
        body: { type: "object", description: "Partial settings" },
        response: {
          200: { description: "Updated settings (secrets redacted)" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsPatchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const current = readSettings();

      const whisper_asr_url =
        body.whisper_asr_url !== undefined
          ? normalizeHostname(String(body.whisper_asr_url))
          : current.whisper_asr_url;
      const transcription_provider =
        body.transcription_provider === "self_hosted"
          ? "self_hosted"
          : body.transcription_provider === "openai"
            ? "openai"
            : body.transcription_provider === "none"
              ? "none"
              : current.transcription_provider;
      const openai_transcription_url =
        body.openai_transcription_url !== undefined
          ? String(body.openai_transcription_url).trim() ||
            OPENAI_TRANSCRIPTION_DEFAULT_URL
          : current.openai_transcription_url;
      let openai_transcription_api_key = current.openai_transcription_api_key;
      if (body.openai_transcription_api_key !== undefined) {
        const v = String(body.openai_transcription_api_key).trim();
        openai_transcription_api_key =
          v === "(set)" ? current.openai_transcription_api_key : v;
      }
      let transcription_model =
        body.transcription_model !== undefined
          ? String(body.transcription_model).trim() ||
            TRANSCRIPTION_DEFAULT_MODEL
          : current.transcription_model;
      if (transcription_provider !== "openai") {
        openai_transcription_api_key = "";
        transcription_model = TRANSCRIPTION_DEFAULT_MODEL;
      }
      const default_can_transcribe =
        body.default_can_transcribe !== undefined
          ? Boolean(body.default_can_transcribe)
          : current.default_can_transcribe;
      const llm_provider =
        body.llm_provider === "openai"
          ? "openai"
          : body.llm_provider === "ollama"
            ? "ollama"
            : "none";
      const ollama_url =
        body.ollama_url !== undefined
          ? String(body.ollama_url).trim()
          : current.ollama_url;
      let openai_api_key = current.openai_api_key;
      if (body.openai_api_key !== undefined) {
        const v = String(body.openai_api_key).trim();
        openai_api_key = v === "(set)" ? current.openai_api_key : v;
      }
      const model =
        body.model !== undefined
          ? String(body.model).trim()
          : llm_provider === "openai"
            ? OPENAI_DEFAULT_MODEL
            : llm_provider === "ollama"
              ? DEFAULTS.model
              : current.model;
      const registration_enabled =
        body.registration_enabled !== undefined
          ? Boolean(body.registration_enabled)
          : current.registration_enabled;
      const public_feeds_enabled =
        body.public_feeds_enabled !== undefined
          ? Boolean(body.public_feeds_enabled)
          : current.public_feeds_enabled;
      const websub_discovery_enabled =
        body.websub_discovery_enabled !== undefined
          ? Boolean(body.websub_discovery_enabled)
          : current.websub_discovery_enabled;
      const hostname =
        body.hostname !== undefined
          ? normalizeHostname(String(body.hostname))
          : current.hostname;
      const websub_hub =
        body.websub_hub !== undefined
          ? String(body.websub_hub).trim()
          : current.websub_hub;
      const final_bitrate_kbps =
        body.final_bitrate_kbps !== undefined
          ? Math.min(
              320,
              Math.max(
                16,
                Number(body.final_bitrate_kbps) || DEFAULTS.final_bitrate_kbps,
              ),
            )
          : current.final_bitrate_kbps;
      const final_channels =
        body.final_channels === "stereo"
          ? "stereo"
          : body.final_channels === "mono"
            ? "mono"
            : current.final_channels;
      const final_format =
        body.final_format === "m4a"
          ? "m4a"
          : body.final_format === "mp3"
            ? "mp3"
            : current.final_format;
      const maxmind_account_id =
        body.maxmind_account_id !== undefined
          ? String(body.maxmind_account_id).trim()
          : current.maxmind_account_id;
      let maxmind_license_key = current.maxmind_license_key;
      if (body.maxmind_license_key !== undefined) {
        const v = String(body.maxmind_license_key).trim();
        maxmind_license_key = v === "(set)" ? current.maxmind_license_key : v;
      }
      const parseOptionalNum = (v: unknown): number | null => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };
      const default_max_podcasts =
        body.default_max_podcasts !== undefined
          ? parseOptionalNum(body.default_max_podcasts)
          : current.default_max_podcasts;
      const default_storage_mb =
        body.default_storage_mb !== undefined
          ? parseOptionalNum(body.default_storage_mb)
          : current.default_storage_mb;
      const default_max_episodes =
        body.default_max_episodes !== undefined
          ? parseOptionalNum(body.default_max_episodes)
          : current.default_max_episodes;
      const default_max_collaborators =
        body.default_max_collaborators !== undefined
          ? parseOptionalNum(body.default_max_collaborators)
          : current.default_max_collaborators;
      const default_max_subscriber_tokens =
        body.default_max_subscriber_tokens !== undefined
          ? parseOptionalNum(body.default_max_subscriber_tokens)
          : current.default_max_subscriber_tokens;
      const captcha_provider =
        body.captcha_provider === "recaptcha_v2" ||
        body.captcha_provider === "recaptcha_v3" ||
        body.captcha_provider === "hcaptcha"
          ? body.captcha_provider
          : body.captcha_provider === "none"
            ? "none"
            : current.captcha_provider;
      let captcha_site_key =
        body.captcha_site_key !== undefined
          ? String(body.captcha_site_key).trim()
          : current.captcha_site_key;
      let captcha_secret_key = current.captcha_secret_key;
      if (body.captcha_secret_key !== undefined) {
        const v = String(body.captcha_secret_key).trim();
        captcha_secret_key = v === "(set)" ? current.captcha_secret_key : v;
      }
      if (captcha_provider === "none") {
        captcha_site_key = "";
        captcha_secret_key = "";
      }
      const email_provider =
        body.email_provider === "smtp"
          ? "smtp"
          : body.email_provider === "sendgrid"
            ? "sendgrid"
            : "none";
      const smtp_host =
        body.smtp_host !== undefined
          ? String(body.smtp_host).trim()
          : current.smtp_host;
      const smtp_port =
        body.smtp_port !== undefined
          ? Math.min(
              65535,
              Math.max(1, Number(body.smtp_port) || DEFAULTS.smtp_port),
            )
          : current.smtp_port;
      const smtp_secure =
        body.smtp_secure !== undefined
          ? Boolean(body.smtp_secure)
          : current.smtp_secure;
      const smtp_user =
        body.smtp_user !== undefined
          ? String(body.smtp_user).trim()
          : current.smtp_user;
      let smtp_password = current.smtp_password;
      if (body.smtp_password !== undefined) {
        const v = String(body.smtp_password).trim();
        smtp_password = v === "(set)" ? current.smtp_password : v;
      }
      const smtp_from =
        body.smtp_from !== undefined
          ? String(body.smtp_from).trim()
          : current.smtp_from;
      let sendgrid_api_key = current.sendgrid_api_key;
      if (body.sendgrid_api_key !== undefined) {
        const v = String(body.sendgrid_api_key).trim();
        sendgrid_api_key = v === "(set)" ? current.sendgrid_api_key : v;
      }
      const sendgrid_from =
        body.sendgrid_from !== undefined
          ? String(body.sendgrid_from).trim()
          : current.sendgrid_from;
      const email_enable_registration_verification =
        body.email_enable_registration_verification !== undefined
          ? Boolean(body.email_enable_registration_verification)
          : current.email_enable_registration_verification;
      const email_enable_welcome_after_verify =
        body.email_enable_welcome_after_verify !== undefined
          ? Boolean(body.email_enable_welcome_after_verify)
          : current.email_enable_welcome_after_verify;
      const email_enable_password_reset =
        body.email_enable_password_reset !== undefined
          ? Boolean(body.email_enable_password_reset)
          : current.email_enable_password_reset;
      const email_enable_admin_welcome =
        body.email_enable_admin_welcome !== undefined
          ? Boolean(body.email_enable_admin_welcome)
          : current.email_enable_admin_welcome;
      const email_enable_new_show =
        body.email_enable_new_show !== undefined
          ? Boolean(body.email_enable_new_show)
          : current.email_enable_new_show;
      const email_enable_invite =
        body.email_enable_invite !== undefined
          ? Boolean(body.email_enable_invite)
          : current.email_enable_invite;
      const email_enable_contact =
        body.email_enable_contact !== undefined
          ? Boolean(body.email_enable_contact)
          : current.email_enable_contact;
      const welcome_banner =
        body.welcome_banner !== undefined
          ? String(body.welcome_banner)
          : current.welcome_banner;
      const custom_terms =
        body.custom_terms !== undefined
          ? String(body.custom_terms)
          : current.custom_terms;
      const custom_privacy =
        body.custom_privacy !== undefined
          ? String(body.custom_privacy)
          : current.custom_privacy;

      const dns_provider =
        body.dns_provider === "cloudflare"
          ? "cloudflare"
          : body.dns_provider === "none"
            ? "none"
            : current.dns_provider;
      let dns_provider_api_token_enc = current.dns_provider_api_token_enc;
      if (body.dns_provider_api_token !== undefined) {
        const v = String(body.dns_provider_api_token).trim();
        if (v === "(set)") {
          dns_provider_api_token_enc = current.dns_provider_api_token_enc;
        } else if (v) {
          dns_provider_api_token_enc = encryptSecret(v, DNS_SECRETS_AAD);
        } else {
          dns_provider_api_token_enc = "";
        }
      }
      if (dns_provider === "cloudflare" && !dns_provider_api_token_enc) {
        return reply.status(400).send({
          error:
            "Provider API Token is required when DNS provider is Cloudflare.",
        });
      }
      if (dns_provider === "none") {
        dns_provider_api_token_enc = "";
      }
      const dns_use_cname =
        body.dns_use_cname !== undefined
          ? Boolean(body.dns_use_cname)
          : current.dns_use_cname;
      const dns_a_record_ip =
        body.dns_a_record_ip !== undefined
          ? String(body.dns_a_record_ip).trim()
          : current.dns_a_record_ip;
      const dns_allow_linking_domain =
        body.dns_allow_linking_domain !== undefined
          ? Boolean(body.dns_allow_linking_domain)
          : current.dns_allow_linking_domain;
      const dns_default_allow_domain =
        body.dns_default_allow_domain !== undefined
          ? Boolean(body.dns_default_allow_domain)
          : current.dns_default_allow_domain;
      const dns_default_allow_domains =
        body.dns_default_allow_domains !== undefined
          ? JSON.stringify(
              Array.isArray(body.dns_default_allow_domains)
                ? body.dns_default_allow_domains.filter((s): s is string => typeof s === "string")
                : [],
            )
          : current.dns_default_allow_domains;
      const dns_default_allow_custom_key =
        body.dns_default_allow_custom_key !== undefined
          ? Boolean(body.dns_default_allow_custom_key)
          : current.dns_default_allow_custom_key;
      const dns_default_allow_sub_domain =
        body.dns_default_allow_sub_domain !== undefined
          ? Boolean(body.dns_default_allow_sub_domain)
          : current.dns_default_allow_sub_domain;
      const dns_default_domain =
        body.dns_default_domain !== undefined
          ? String(body.dns_default_domain).trim()
          : current.dns_default_domain;
      const dns_default_enable_cloudflare_proxy =
        body.dns_default_enable_cloudflare_proxy !== undefined
          ? Boolean(body.dns_default_enable_cloudflare_proxy)
          : current.dns_default_enable_cloudflare_proxy;

      const next: AppSettings = {
        whisper_asr_url,
        transcription_provider,
        openai_transcription_url,
        openai_transcription_api_key,
        transcription_model,
        default_can_transcribe,
        llm_provider,
        ollama_url,
        openai_api_key,
        model:
          model ||
          (llm_provider === "openai"
            ? OPENAI_DEFAULT_MODEL
            : llm_provider === "ollama"
              ? DEFAULTS.model
              : current.model),
        registration_enabled,
        public_feeds_enabled,
        websub_discovery_enabled,
        hostname,
        websub_hub,
        final_bitrate_kbps,
        final_channels,
        final_format,
        maxmind_account_id,
        maxmind_license_key,
        default_max_podcasts,
        default_storage_mb,
        default_max_episodes,
        default_max_collaborators,
        default_max_subscriber_tokens,
        captcha_provider,
        captcha_site_key,
        captcha_secret_key,
        email_provider,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_user,
        smtp_password,
        smtp_from,
        sendgrid_api_key,
        sendgrid_from,
        email_enable_registration_verification,
        email_enable_welcome_after_verify,
        email_enable_password_reset,
        email_enable_admin_welcome,
        email_enable_new_show,
        email_enable_invite,
        email_enable_contact,
        welcome_banner,
        custom_terms,
        custom_privacy,
        dns_provider,
        dns_provider_api_token_enc,
        dns_use_cname,
        dns_a_record_ip,
        dns_allow_linking_domain,
        dns_default_allow_domain,
        dns_default_allow_domains,
        dns_default_allow_custom_key,
        dns_default_allow_sub_domain,
        dns_default_domain,
        dns_default_enable_cloudflare_proxy,
      };
      const maxmindKeysChanged =
        next.maxmind_account_id !== current.maxmind_account_id ||
        next.maxmind_license_key !== current.maxmind_license_key;

      writeSettings(next);

      if (
        maxmindKeysChanged &&
        next.maxmind_account_id &&
        next.maxmind_license_key
      ) {
        runGeoIPUpdate(next.maxmind_account_id, next.maxmind_license_key)
          .then((result) => {
            if (result.ok) {
              console.log(
                "GeoLite2 databases (Country, City) updated successfully in",
                getDataDir(),
              );
            } else {
              console.error("GeoLite2 update failed:", result.error);
            }
          })
          .catch((err) => console.error("GeoLite2 update error:", err));
      }

      return {
        ...next,
        openai_api_key: next.openai_api_key ? "(set)" : "",
        openai_transcription_api_key: next.openai_transcription_api_key
          ? "(set)"
          : "",
        maxmind_license_key: next.maxmind_license_key ? "(set)" : "",
        captcha_secret_key: next.captcha_secret_key ? "(set)" : "",
        smtp_password: next.smtp_password ? "(set)" : "",
        sendgrid_api_key: next.sendgrid_api_key ? "(set)" : "",
        custom_terms: next.custom_terms ?? "",
        custom_privacy: next.custom_privacy ?? "",
        dns_provider_api_token_enc: "",
        dns_provider_api_token_set: Boolean(
          next.dns_provider_api_token_enc &&
            isEncryptedSecret(next.dns_provider_api_token_enc),
        ),
      };
    },
  );

  app.post(
    "/settings/test-llm",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "llm", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test LLM connection",
        description:
          "Verify LLM provider (Ollama/OpenAI) is reachable. Admin only.",
        body: {
          type: "object",
          properties: {
            llm_provider: { type: "string" },
            ollama_url: { type: "string" },
            openai_api_key: { type: "string" },
          },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestLlmBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const current = readSettings();
      const provider = body.llm_provider ?? current.llm_provider;

      if (provider === "none") {
        return reply.send({ ok: false, error: "No LLM provider selected" });
      }

      if (provider === "ollama") {
        let ollama_url: string;
        try {
          ollama_url = validateOllamaBaseUrl(
            body.ollama_url ?? current.ollama_url,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Invalid Ollama URL";
          return reply.send({ ok: false, error: msg });
        }
        try {
          const base = validateOllamaBaseUrl(ollama_url);
          const res = await fetch(`${base}/tags`, { method: "GET" });
          if (!res.ok) {
            const text = await res.text();
            return reply.send({
              ok: false,
              error: text || `Ollama returned ${res.status}`,
            });
          }
          return reply.send({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.send({ ok: false, error: msg });
        }
      }

      if (provider === "openai") {
        const openai_api_key =
          body.openai_api_key !== undefined && body.openai_api_key !== "(set)"
            ? String(body.openai_api_key).trim()
            : current.openai_api_key;
        if (!openai_api_key) {
          return reply.send({ ok: false, error: "OpenAI API key is not set" });
        }
        try {
          const res = await fetch(OPENAI_MODELS_URL, {
            method: "GET",
            headers: { Authorization: `Bearer ${openai_api_key}` },
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const msg =
              (data as { error?: { message?: string } })?.error?.message ||
              (await res.text()) ||
              `OpenAI returned ${res.status}`;
            return reply.send({ ok: false, error: redactError(msg) });
          }
          return reply.send({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.send({ ok: false, error: redactError(msg) });
        }
      }

      return reply.send({ ok: false, error: "Invalid provider" });
    },
  );

  app.post(
    "/settings/test-whisper",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "whisper", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test Whisper ASR",
        description: "Verify Whisper ASR URL is reachable. Admin only.",
        body: {
          type: "object",
          properties: { whisper_asr_url: { type: "string" } },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestWhisperBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const current = readSettings();
      const raw = normalizeHostname(
        body.whisper_asr_url ?? current.whisper_asr_url ?? "",
      );
      if (!raw) {
        return reply.send({ ok: false, error: "Whisper ASR URL is not set" });
      }
      let openapiUrl: string;
      try {
        const u = new URL(raw);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          return reply.send({
            ok: false,
            error: "Whisper ASR URL must use http or https",
          });
        }
        const path = normalizeHostname(u.pathname || "");
        u.pathname = path ? `${path}/openapi.json` : "/openapi.json";
        openapiUrl = u.toString();
      } catch {
        return reply.send({ ok: false, error: "Invalid Whisper ASR URL" });
      }
      try {
        const res = await fetch(openapiUrl, { method: "HEAD" });
        if (res.ok) {
          return reply.send({ ok: true });
        }
        return reply.send({
          ok: false,
          error: `openapi.json returned ${res.status}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: msg });
      }
    },
  );

  app.post(
    "/settings/test-transcription-openai",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "whisper", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test OpenAI transcription",
        description: "Verify OpenAI API key for transcription. Admin only.",
        body: {
          type: "object",
          properties: {
            openai_transcription_url: { type: "string" },
            openai_transcription_api_key: { type: "string" },
          },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestTranscriptionOpenaiBodySchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const current = readSettings();
      const urlRaw =
        body.openai_transcription_url ?? current.openai_transcription_url;
      const baseUrl = (
        urlRaw?.trim() || OPENAI_TRANSCRIPTION_DEFAULT_URL
      ).replace(/\/audio\/transcriptions\/?$/, "");
      const apiKey =
        body.openai_transcription_api_key !== undefined &&
        body.openai_transcription_api_key !== "(set)"
          ? String(body.openai_transcription_api_key).trim()
          : current.openai_transcription_api_key;
      if (!apiKey) {
        return reply.send({
          ok: false,
          error: "OpenAI API key for transcription is not set",
        });
      }
      let modelsUrl: string;
      try {
        const parsedUrl = new URL(
          baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`,
        );
        modelsUrl = `${parsedUrl.origin}/v1/models`;
      } catch {
        modelsUrl = `${baseUrl}/v1/models`;
      }
      try {
        const res = await fetch(modelsUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.status === 401) {
          return reply.send({ ok: false, error: "Invalid API key" });
        }
        if (!res.ok) {
          const bodyText = await res.text();
          let msg = `OpenAI returned ${res.status}`;
          try {
            const data = JSON.parse(bodyText) as {
              error?: { message?: string };
            };
            if (data?.error?.message) msg = data.error.message;
          } catch {
            if (bodyText.trim()) msg = bodyText;
          }
          return reply.send({ ok: false, error: redactError(msg) });
        }
        return reply.send({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: redactError(msg) });
      }
    },
  );

  app.post(
    "/settings/test-smtp",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "smtp", windowMs: 2000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test SMTP",
        description: "Verify SMTP credentials. Admin only.",
        body: {
          type: "object",
          properties: {
            smtp_host: { type: "string" },
            smtp_port: { type: "number" },
            smtp_user: { type: "string" },
            smtp_password: { type: "string" },
          },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestSmtpBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const current = readSettings();
      const host =
        (body.smtp_host !== undefined
          ? String(body.smtp_host).trim()
          : current.smtp_host) || "";
      const port =
        body.smtp_port !== undefined
          ? Math.min(65535, Math.max(1, Number(body.smtp_port) || 587))
          : current.smtp_port;
      const secure =
        body.smtp_secure !== undefined
          ? Boolean(body.smtp_secure)
          : current.smtp_secure;
      const user =
        (body.smtp_user !== undefined
          ? String(body.smtp_user).trim()
          : current.smtp_user) || "";
      let password = current.smtp_password ?? "";
      if (body.smtp_password !== undefined && body.smtp_password !== "(set)") {
        const v = String(body.smtp_password).trim();
        if (v) password = v;
      }
      if (!host || !user || !password) {
        return reply.send({
          ok: false,
          error: "Host, username, and password are required",
        });
      }
      const result = await verifySmtpCredentials({
        host,
        port,
        secure,
        user,
        password,
      });
      return reply.send(result);
    },
  );

  app.post(
    "/settings/test-sendgrid",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "sendgrid", windowMs: 2000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test SendGrid",
        description: "Verify SendGrid API key. Admin only.",
        body: {
          type: "object",
          properties: { sendgrid_api_key: { type: "string" } },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestSendgridBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const current = readSettings();
      let apiKey = current.sendgrid_api_key ?? "";
      if (
        body.sendgrid_api_key !== undefined &&
        body.sendgrid_api_key !== "(set)"
      ) {
        const v = String(body.sendgrid_api_key).trim();
        if (v) apiKey = v;
      }
      if (!apiKey) {
        return reply.send({ ok: false, error: "SendGrid API key is required" });
      }
      try {
        const res = await fetch(SENDGRID_SCOPES_URL, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          return reply.send({ ok: true });
        }
        const data = await res.json().catch(() => ({}));
        const msg =
          (data as { errors?: Array<{ message?: string }> })?.errors?.[0]
            ?.message ??
          res.statusText ??
          `SendGrid returned ${res.status}`;
        return reply.send({ ok: false, error: msg });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: msg });
      }
    },
  );

  app.post(
    "/settings/geolite/test",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "geolite-test", windowMs: 5000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test MaxMind credentials",
        description:
          "Validate Account ID and License Key by running geoipupdate in a temp directory. If credentials are omitted, uses saved settings. Admin only.",
        body: {
          type: "object",
          properties: {
            maxmind_account_id: { type: "string" },
            maxmind_license_key: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" }, error: { type: "string" } },
            required: ["ok"],
          },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsGeoliteTestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const accountId = body.maxmind_account_id?.trim();
      const licenseKey =
        body.maxmind_license_key != null && body.maxmind_license_key !== ""
          ? body.maxmind_license_key.trim()
          : undefined;
      const result = await validateMaxMindCredentials(
        accountId,
        licenseKey,
        () => {
          const current = readSettings();
          return {
            accountId: (current.maxmind_account_id ?? "").trim(),
            licenseKey: (current.maxmind_license_key ?? "").trim(),
          };
        },
      );
      return reply.send(result);
    },
  );

  app.get(
    "/settings/geolite/check",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Check GeoLite2 databases",
        description:
          "Verify whether GeoLite2-City and/or GeoLite2-Country database files exist. Admin only.",
        response: {
          200: {
            type: "object",
            properties: {
              city: { type: "boolean" },
              country: { type: "boolean" },
            },
            required: ["city", "country"],
          },
        },
      },
    },
    async (_request, reply) => {
      const result = checkGeoLiteDatabases();
      return reply.send(result);
    },
  );

  app.post(
    "/settings/geolite/update",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "geolite-update", windowMs: 60_000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Update GeoLite2 databases",
        description:
          "Run geoipupdate with the provided or saved MaxMind credentials. If license key is omitted or empty, the saved key is used. Admin only.",
        body: {
          type: "object",
          properties: {
            maxmind_account_id: { type: "string" },
            maxmind_license_key: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" }, error: { type: "string" } },
            required: ["ok"],
          },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsGeoliteTestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const accountId = body.maxmind_account_id?.trim();
      const licenseKey =
        body.maxmind_license_key != null && body.maxmind_license_key !== ""
          ? body.maxmind_license_key.trim()
          : undefined;
      const result = await runGeoIPUpdate(accountId, licenseKey, () => {
        const current = readSettings();
        return {
          accountId: (current.maxmind_account_id ?? "").trim(),
          licenseKey: (current.maxmind_license_key ?? "").trim(),
        };
      });
      if (result.ok) {
        refreshGeoLiteReaders();
      }
      return reply.send(result);
    },
  );
}
