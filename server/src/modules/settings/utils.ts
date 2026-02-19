import { join } from "path";
import {
  FFMPEG_PATH,
  FFPROBE_PATH,
  AUDIOWAVEFORM_PATH,
} from "../../config.js";
import { getDataDir } from "../../services/paths.js";
import { normalizeHostname } from "../../utils/url.js";
import { isEncryptedSecret } from "../../services/secrets.js";

export const SETTINGS_FILENAME = "settings.json";

/** Whitelist of commands the server may use. Keys are display names; value is path + args for presence check. */
export const COMMANDS_WHITELIST: Record<string, { path: string; args: string[] }> = {
  ffmpeg: { path: FFMPEG_PATH, args: ["-version"] },
  ffprobe: { path: FFPROBE_PATH, args: ["-version"] },
  audiowaveform: { path: AUDIOWAVEFORM_PATH, args: ["--version"] },
  geoipupdate: { path: "geoipupdate", args: ["-V"] },
  smbclient: { path: "smbclient", args: ["--version"] },
};

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
  email_provider: "none" | "smtp" | "sendgrid" | "webhook";
  /** Webhook URL for email (when email_provider is webhook). POST body is { [email_webhook_field_key]: content }. */
  email_webhook_url: string;
  /** Key for the webhook JSON body (default "content"). Discord uses "content". */
  email_webhook_field_key: string;
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
  /** When true, show GDPR-style cookie/tracking consent banner on public pages. */
  gdpr_consent_banner_enabled: boolean;
  /** WebRTC service base URL (e.g. http://webrtc:3002). When set with webrtc_public_ws_url, group calls create a mediasoup room. */
  webrtc_service_url: string;
  /** Public WebSocket URL for the WebRTC service (e.g. wss://example.com/webrtc-ws). Returned to clients so the browser can connect. */
  webrtc_public_ws_url: string;
  /** Secret for webrtc service to call back when a recording is ready. Env RECORDING_CALLBACK_SECRET can override. */
  recording_callback_secret: string;
  /** When true, 2FA is available for users. */
  two_factor_enabled: boolean;
  /** Allowed 2FA methods: "totp", "email", or "totp,email". */
  two_factor_methods: string;
  /** When true and 2FA enabled, users without 2FA must add it after password login. */
  two_factor_enforced: boolean;
}

export const OPENAI_TRANSCRIPTION_DEFAULT_URL =
  "https://api.openai.com/v1/audio/transcriptions";
export const TRANSCRIPTION_DEFAULT_MODEL = "whisper-1";

export const DEFAULTS: AppSettings = {
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
  email_webhook_url: "",
  email_webhook_field_key: "content",
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
  gdpr_consent_banner_enabled: false,
  webrtc_service_url: "",
  webrtc_public_ws_url: "",
  recording_callback_secret: "",
  two_factor_enabled: false,
  two_factor_methods: "totp",
  two_factor_enforced: false,
};

export const OPENAI_DEFAULT_MODEL = "gpt5-mini";

export function getSettingsPath(): string {
  return join(getDataDir(), SETTINGS_FILENAME);
}

export function validateOllamaBaseUrl(input: string): string {
  const raw = (input || "").trim() || "http://localhost:11434";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid Ollama URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ollama URL must use http or https");
  }

  if (!url.hostname) {
    throw new Error("Ollama URL must include a hostname");
  }

  const normalized = new URL(url.toString());
  normalized.pathname = normalizeHostname(normalized.pathname);

  return normalized.toString();
}

export function parseBool(v: string): boolean {
  return v === "true" || v === "1" || v === "yes";
}

export function buildAppSettingsFromRows(
  rows: Array<{ key: string; value: string }>,
): AppSettings {
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
      settings.default_can_transcribe = parseBool(row.value);
    else if (row.key === "llm_provider")
      settings.llm_provider = row.value as AppSettings["llm_provider"];
    else if (row.key === "ollama_url") settings.ollama_url = row.value;
    else if (row.key === "openai_api_key") settings.openai_api_key = row.value;
    else if (row.key === "model") settings.model = row.value;
    else if (row.key === "registration_enabled")
      settings.registration_enabled = parseBool(row.value);
    else if (row.key === "public_feeds_enabled")
      settings.public_feeds_enabled = parseBool(row.value);
    else if (row.key === "websub_discovery_enabled")
      settings.websub_discovery_enabled = parseBool(row.value);
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
      if (v === "smtp" || v === "sendgrid" || v === "webhook" || v === "none")
        settings.email_provider = v;
    } else if (row.key === "email_webhook_url")
      settings.email_webhook_url = row.value;
    else if (row.key === "email_webhook_field_key")
      settings.email_webhook_field_key = row.value;
    else if (row.key === "smtp_host") settings.smtp_host = row.value;
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
    } else if (row.key === "dns_provider_api_token_enc")
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
    else if (row.key === "gdpr_consent_banner_enabled")
      (settings as Partial<AppSettings>).gdpr_consent_banner_enabled =
        row.value === "true";
    else if (row.key === "webrtc_service_url")
      (settings as Partial<AppSettings>).webrtc_service_url = row.value;
    else if (row.key === "webrtc_public_ws_url")
      (settings as Partial<AppSettings>).webrtc_public_ws_url = row.value;
    else if (row.key === "recording_callback_secret")
      (settings as Partial<AppSettings>).recording_callback_secret = row.value;
    else if (row.key === "two_factor_enabled")
      (settings as Partial<AppSettings>).two_factor_enabled =
        row.value === "true";
    else if (row.key === "two_factor_methods")
      (settings as Partial<AppSettings>).two_factor_methods = row.value;
    else if (row.key === "two_factor_enforced")
      (settings as Partial<AppSettings>).two_factor_enforced =
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
    email_webhook_url: settings.email_webhook_url ?? DEFAULTS.email_webhook_url,
    email_webhook_field_key:
      settings.email_webhook_field_key ?? DEFAULTS.email_webhook_field_key,
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
    gdpr_consent_banner_enabled:
      (settings as Partial<AppSettings>).gdpr_consent_banner_enabled ??
      DEFAULTS.gdpr_consent_banner_enabled,
    webrtc_service_url:
      (settings as Partial<AppSettings>).webrtc_service_url ??
      DEFAULTS.webrtc_service_url,
    webrtc_public_ws_url:
      (settings as Partial<AppSettings>).webrtc_public_ws_url ??
      DEFAULTS.webrtc_public_ws_url,
    recording_callback_secret:
      (settings as Partial<AppSettings>).recording_callback_secret ??
      DEFAULTS.recording_callback_secret,
    two_factor_enabled:
      (settings as Partial<AppSettings>).two_factor_enabled ??
      DEFAULTS.two_factor_enabled,
    two_factor_methods:
      (settings as Partial<AppSettings>).two_factor_methods ??
      DEFAULTS.two_factor_methods,
    two_factor_enforced:
      (settings as Partial<AppSettings>).two_factor_enforced ??
      DEFAULTS.two_factor_enforced,
  };
}

/** Whether an email provider is configured (smtp, sendgrid, or webhook). */
export function isEmailProviderConfigured(settings: AppSettings): boolean {
  return (
    settings.email_provider === "smtp" ||
    settings.email_provider === "sendgrid" ||
    settings.email_provider === "webhook"
  );
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

/** Map AppSettings (internal snake_case) to API response (camelCase). */
export function settingsToApiResponse(
  settings: AppSettings,
  ssoOidc: Array<Record<string, unknown>>,
  ssoSaml: Array<Record<string, unknown>>,
) {
  return {
    whisperAsrUrl: settings.whisper_asr_url,
    transcriptionProvider: settings.transcription_provider,
    openaiTranscriptionUrl: settings.openai_transcription_url,
    openaiTranscriptionApiKey: settings.openai_transcription_api_key ? "(set)" : "",
    transcriptionModel: settings.transcription_model,
    defaultCanTranscribe: settings.default_can_transcribe,
    llmProvider: settings.llm_provider,
    ollamaUrl: settings.ollama_url,
    openaiApiKey: settings.openai_api_key ? "(set)" : "",
    model: settings.model,
    registrationEnabled: settings.registration_enabled,
    publicFeedsEnabled: settings.public_feeds_enabled,
    websubDiscoveryEnabled: settings.websub_discovery_enabled,
    hostname: settings.hostname,
    websubHub: settings.websub_hub,
    finalBitrateKbps: settings.final_bitrate_kbps,
    finalChannels: settings.final_channels,
    finalFormat: settings.final_format,
    maxmindAccountId: settings.maxmind_account_id,
    maxmindLicenseKey: settings.maxmind_license_key ? "(set)" : "",
    defaultMaxPodcasts: settings.default_max_podcasts,
    defaultStorageMb: settings.default_storage_mb,
    defaultMaxEpisodes: settings.default_max_episodes,
    defaultMaxCollaborators: settings.default_max_collaborators,
    defaultMaxSubscriberTokens: settings.default_max_subscriber_tokens,
    captchaProvider: settings.captcha_provider,
    captchaSiteKey: settings.captcha_site_key,
    captchaSecretKey: settings.captcha_secret_key ? "(set)" : "",
    emailProvider: settings.email_provider,
    emailWebhookUrl: settings.email_webhook_url,
    emailWebhookFieldKey: settings.email_webhook_field_key,
    smtpHost: settings.smtp_host,
    smtpPort: settings.smtp_port,
    smtpSecure: settings.smtp_secure,
    smtpUser: settings.smtp_user,
    smtpPassword: settings.smtp_password ? "(set)" : "",
    smtpFrom: settings.smtp_from,
    sendgridApiKey: settings.sendgrid_api_key ? "(set)" : "",
    sendgridFrom: settings.sendgrid_from,
    emailEnableRegistrationVerification: settings.email_enable_registration_verification,
    emailEnableWelcomeAfterVerify: settings.email_enable_welcome_after_verify,
    emailEnablePasswordReset: settings.email_enable_password_reset,
    emailEnableAdminWelcome: settings.email_enable_admin_welcome,
    emailEnableNewShow: settings.email_enable_new_show,
    emailEnableInvite: settings.email_enable_invite,
    emailEnableContact: settings.email_enable_contact,
    welcomeBanner: settings.welcome_banner,
    customTerms: settings.custom_terms ?? "",
    customPrivacy: settings.custom_privacy ?? "",
    dnsProvider: settings.dns_provider,
    dnsProviderApiTokenEnc: "", // never send to client
    dnsProviderApiTokenSet: Boolean(
      settings.dns_provider_api_token_enc &&
        isEncryptedSecret(settings.dns_provider_api_token_enc),
    ),
    dnsUseCname: settings.dns_use_cname,
    dnsARecordIp: settings.dns_a_record_ip ?? "",
    dnsAllowLinkingDomain: settings.dns_allow_linking_domain,
    dnsDefaultAllowDomain: settings.dns_default_allow_domain,
    dnsDefaultAllowDomains: settings.dns_default_allow_domains,
    dnsDefaultAllowCustomKey: settings.dns_default_allow_custom_key,
    dnsDefaultAllowSubDomain: settings.dns_default_allow_sub_domain,
    dnsDefaultDomain: settings.dns_default_domain,
    dnsDefaultEnableCloudflareProxy: settings.dns_default_enable_cloudflare_proxy,
    gdprConsentBannerEnabled: settings.gdpr_consent_banner_enabled,
    webrtcServiceUrl: settings.webrtc_service_url,
    webrtcPublicWsUrl: settings.webrtc_public_ws_url,
    recordingCallbackSecret: settings.recording_callback_secret ? "(set)" : "",
    twoFactorEnabled: settings.two_factor_enabled,
    twoFactorMethods: settings.two_factor_methods,
    twoFactorEnforced: settings.two_factor_enforced,
    ssoOidcProviders: ssoOidc,
    ssoSamlProviders: ssoSaml,
  };
}
