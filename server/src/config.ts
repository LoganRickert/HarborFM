import { join } from "path";
import { parseShareRole } from "./utils/roles.js";

/**
 * Central app config. All values can be overridden via environment variables.
 * Use .env or set in the shell when running the server.
 */

/** Application display name (emails, RSS, etc). Env: APP_NAME */
export const APP_NAME = process.env.APP_NAME?.trim() || "HarborFM";

/** Slug form of APP_NAME (lowercase, spaces to hyphens) for filenames, cookie names, etc. */
export const APP_NAME_SLUG = APP_NAME.toLowerCase().replace(/\s+/g, "-");

/** Server port. Env: PORT. Default 3001. */
export const PORT = Number(process.env.PORT) || 3001;

/** Server listen host. Env: HOST. Default "0.0.0.0". */
export const HOST = process.env.HOST?.trim() || "0.0.0.0";

/** Enable Fastify logger. Env: LOGGER. Set to "false" or "0" to disable. Default true. */
export const LOGGER =
  process.env.LOGGER !== "false" && process.env.LOGGER !== "0";

/** Trust X-Forwarded-* headers (set true when behind a reverse proxy). Env: TRUST_PROXY. Set to "false" or "0" to disable. Default true. */
export const TRUST_PROXY =
  process.env.TRUST_PROXY === "false" || process.env.TRUST_PROXY === "0"
    ? false
    : true;

/** API path segment (no slashes). Routes live under /${API_PREFIX}/. Env: API_PREFIX. Default "api". */
export const API_PREFIX = process.env.API_PREFIX?.trim() || "api";

/** CORS origin: true = allow request origin (e.g. dev), false = no CORS. Env: CORS_ORIGIN. Default: false in production, true otherwise. */
export const CORS_ORIGIN =
  process.env.CORS_ORIGIN !== undefined
    ? process.env.CORS_ORIGIN === "true" || process.env.CORS_ORIGIN === "1"
    : process.env.NODE_ENV !== "production";

/** Min free storage (MB) required to record a new section. Env: RECORD_MIN_FREE_MB. Default 5. */
export const RECORD_MIN_FREE_MB = Number(process.env.RECORD_MIN_FREE_MB) || 5;
export const RECORD_MIN_FREE_BYTES = RECORD_MIN_FREE_MB * 1024 * 1024;

/** RSS/sitemap cache max age in ms. Env: RSS_CACHE_MAX_AGE_MS. Default 1 hour. */
export const RSS_CACHE_MAX_AGE_MS =
  Number(process.env.RSS_CACHE_MAX_AGE_MS) || 60 * 60 * 1000;

/** RSS feed filename (e.g. feed.xml). Env: RSS_FEED_FILENAME. Default "feed.xml". */
export const RSS_FEED_FILENAME =
  process.env.RSS_FEED_FILENAME?.trim() || "feed.xml";

/** Sitemap filename for per-podcast/static sitemaps. Env: SITEMAP_FILENAME. Default "sitemap.xml". */
export const SITEMAP_FILENAME =
  process.env.SITEMAP_FILENAME?.trim() || "sitemap.xml";

/** Sitemap index filename (root sitemap). Env: SITEMAP_INDEX_FILENAME. Default "index.xml". */
export const SITEMAP_INDEX_FILENAME =
  process.env.SITEMAP_INDEX_FILENAME?.trim() || "index.xml";

/** Max episode source audio upload size (MB). Env: EPISODE_AUDIO_UPLOAD_MAX_MB. Default 500. */
export const EPISODE_AUDIO_UPLOAD_MAX_MB =
  Number(process.env.EPISODE_AUDIO_UPLOAD_MAX_MB) || 500;
export const EPISODE_AUDIO_UPLOAD_MAX_BYTES =
  EPISODE_AUDIO_UPLOAD_MAX_MB * 1024 * 1024;

/** Max recorded segment upload size (MB). Env: SEGMENT_UPLOAD_MAX_MB. Default 100. */
export const SEGMENT_UPLOAD_MAX_MB =
  Number(process.env.SEGMENT_UPLOAD_MAX_MB) || 100;
export const SEGMENT_UPLOAD_MAX_BYTES = SEGMENT_UPLOAD_MAX_MB * 1024 * 1024;

/** Max library asset upload size (MB). Env: LIBRARY_UPLOAD_MAX_MB. Default 50. */
export const LIBRARY_UPLOAD_MAX_MB =
  Number(process.env.LIBRARY_UPLOAD_MAX_MB) || 50;
export const LIBRARY_UPLOAD_MAX_BYTES = LIBRARY_UPLOAD_MAX_MB * 1024 * 1024;

/** Max multipart body size (MB) for Fastify. Env: MULTIPART_MAX_MB. Default 500. */
export const MULTIPART_MAX_MB = Number(process.env.MULTIPART_MAX_MB) || 500;
export const MULTIPART_MAX_BYTES = MULTIPART_MAX_MB * 1024 * 1024;

/** Max podcast/episode artwork upload size (MB). Env: ARTWORK_MAX_MB. Default 5. */
export const ARTWORK_MAX_MB = Number(process.env.ARTWORK_MAX_MB) || 5;
export const ARTWORK_MAX_BYTES = ARTWORK_MAX_MB * 1024 * 1024;

/** Path to ffmpeg binary. Env: FFMPEG_PATH. Default "ffmpeg". */
export const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "ffmpeg";

/** Path to ffprobe binary. Env: FFPROBE_PATH. Default "ffprobe". */
export const FFPROBE_PATH = process.env.FFPROBE_PATH ?? "ffprobe";

/** Path to audiowaveform binary. Env: AUDIOWAVEFORM_PATH. Default "audiowaveform". */
export const AUDIOWAVEFORM_PATH =
  process.env.AUDIOWAVEFORM_PATH ?? "audiowaveform";

/** Path to geoipupdate binary. Env: GEOIPUPDATE_PATH. Default "geoipupdate". */
export const GEOIPUPDATE_PATH = process.env.GEOIPUPDATE_PATH ?? "geoipupdate";

/** Path to smbclient binary. Env: SMBCLIENT_PATH. Default "smbclient". */
export const SMBCLIENT_PATH = process.env.SMBCLIENT_PATH ?? "smbclient";

/** GeoIP config filename for geoipupdate. Env: GEOIP_CONF_FILENAME. Default "GeoIP.conf". */
export const GEOIP_CONF_FILENAME =
  process.env.GEOIP_CONF_FILENAME?.trim() || "GeoIP.conf";

/** GeoIP edition IDs (space-separated) for geoipupdate. Env: GEOIP_EDITION_IDS. Default "GeoLite2-Country GeoLite2-City". */
export const GEOIP_EDITION_IDS =
  process.env.GEOIP_EDITION_IDS?.trim() || "GeoLite2-Country GeoLite2-City";

/** Extension for waveform JSON files (replaces audio extension). Env: WAVEFORM_EXTENSION. Default ".waveform.json". */
export const WAVEFORM_EXTENSION =
  process.env.WAVEFORM_EXTENSION?.trim() || ".waveform.json";

/** Directory to serve static web app from. Env: PUBLIC_DIR. Default "public" under project. */
export const PUBLIC_DIR =
  process.env.PUBLIC_DIR ?? join(process.cwd(), "public");

/** SQLite database filename (under DATA_DIR). Env: DB_FILENAME. Default derived from APP_NAME (e.g. harborfm.db). */
export const DB_FILENAME =
  process.env.DB_FILENAME?.trim() || `${APP_NAME_SLUG}.db`;

/** Max "invite to platform" emails per inviter per 24 hours. Env: PLATFORM_INVITES_PER_DAY. Default 10. */
export const MAX_PLATFORM_INVITES_PER_DAY =
  Number(process.env.PLATFORM_INVITES_PER_DAY) || 10;

/** Prefix for API keys (used to distinguish from other tokens). Env: API_KEY_PREFIX. Default "hfm_". */
export const API_KEY_PREFIX = process.env.API_KEY_PREFIX?.trim() || "hfm_";

/** Max API keys per user. Env: MAX_API_KEYS_PER_USER. Default 5. */
export const MAX_API_KEYS_PER_USER =
  Number(process.env.MAX_API_KEYS_PER_USER) || 5;

/** Prefix for subscriber RSS tokens (used in URL path). Env: SUBSCRIBER_TOKEN_PREFIX. Default "hfm_sub_". */
export const SUBSCRIBER_TOKEN_PREFIX =
  process.env.SUBSCRIBER_TOKEN_PREFIX?.trim() || "hfm_sub_";

/** Name of the CSRF cookie. Env: CSRF_COOKIE_NAME. Default derived from APP_NAME (e.g. harborfm_csrf). */
export const CSRF_COOKIE_NAME =
  process.env.CSRF_COOKIE_NAME?.trim() || `${APP_NAME_SLUG}_csrf`;

/** CSRF cookie max age in seconds. Env: CSRF_COOKIE_MAX_AGE_SECONDS. Default 7 days. */
export const CSRF_COOKIE_MAX_AGE_SECONDS =
  Number(process.env.CSRF_COOKIE_MAX_AGE_SECONDS) || 60 * 60 * 24 * 7;

/** Name of the JWT session cookie. Env: JWT_COOKIE_NAME. Default derived from APP_NAME (e.g. harborfm_jwt). */
export const JWT_COOKIE_NAME =
  process.env.JWT_COOKIE_NAME?.trim() || `${APP_NAME_SLUG}_jwt`;

/** Whether the JWT cookie is signed (requires @fastify/cookie secret). Env: JWT_COOKIE_SIGNED. Default false. */
export const JWT_COOKIE_SIGNED =
  process.env.JWT_COOKIE_SIGNED === "true" ||
  process.env.JWT_COOKIE_SIGNED === "1";

/** Forgot-password request cooldown (minutes). Env: FORGOT_PASSWORD_RATE_MINUTES. Default 5. */
export const FORGOT_PASSWORD_RATE_MINUTES =
  Number(process.env.FORGOT_PASSWORD_RATE_MINUTES) || 5;

/** Login failure threshold: ban after this many failures in the window. Env: LOGIN_FAILURE_THRESHOLD. Default 3. */
export const LOGIN_FAILURE_THRESHOLD =
  Number(process.env.LOGIN_FAILURE_THRESHOLD) || 3;

/** Login ban duration (minutes). Env: LOGIN_BAN_MINUTES. Default 10. */
export const LOGIN_BAN_MINUTES = Number(process.env.LOGIN_BAN_MINUTES) || 10;

/** Login failure counting window (minutes). Env: LOGIN_WINDOW_MINUTES. Default 10. */
export const LOGIN_WINDOW_MINUTES =
  Number(process.env.LOGIN_WINDOW_MINUTES) || 10;

/** Password reset (and set-password) link validity (hours). Env: RESET_TOKEN_EXPIRY_HOURS. Default 1. */
export const RESET_TOKEN_EXPIRY_HOURS =
  Number(process.env.RESET_TOKEN_EXPIRY_HOURS) || 1;

/** Global rate limit: max requests per time window. Env: RATE_LIMIT_MAX. Default 100. */
export const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 100;

/** Global rate limit: time window (e.g. "1 minute"). Env: RATE_LIMIT_TIME_WINDOW. Default "1 minute". */
export const RATE_LIMIT_TIME_WINDOW =
  process.env.RATE_LIMIT_TIME_WINDOW?.trim() || "1 minute";

/** Podcast stats flush interval (ms). Env: STATS_FLUSH_INTERVAL_MS. Default 60000 (1 minute). */
export const STATS_FLUSH_INTERVAL_MS =
  Number(process.env.STATS_FLUSH_INTERVAL_MS) || 60_000;

/** Min bytes requested in one range to count as a listen. Env: LISTEN_THRESHOLD_BYTES. Default 256000 (250 KB). */
export const LISTEN_THRESHOLD_BYTES =
  Number(process.env.LISTEN_THRESHOLD_BYTES) || 250 * 1024;

/** Swagger UI route prefix. Env: SWAGGER_UI_ROUTE_PREFIX. Default "/api/docs" (derived from API_PREFIX). */
export const SWAGGER_UI_ROUTE_PREFIX =
  process.env.SWAGGER_UI_ROUTE_PREFIX?.trim() || `/${API_PREFIX}/docs`;

/** Swagger UI theme CSS filename (injected into docs page). Env: SWAGGER_UI_THEME_CSS_FILENAME. Default derived from APP_NAME (e.g. harborfm.css). */
export const SWAGGER_UI_THEME_CSS_FILENAME =
  process.env.SWAGGER_UI_THEME_CSS_FILENAME?.trim() || `${APP_NAME_SLUG}.css`;

/** Whether to serve Swagger UI at /api/docs. In non-production always true; in production set SWAGGER_ENABLED=true to enable. */
export const SWAGGER_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.SWAGGER_ENABLED === "true";

/** OpenAI chat completions API URL. Env: OPENAI_CHAT_COMPLETIONS_URL. Default "https://api.openai.com/v1/chat/completions". */
export const OPENAI_CHAT_COMPLETIONS_URL =
  process.env.OPENAI_CHAT_COMPLETIONS_URL?.trim() ||
  "https://api.openai.com/v1/chat/completions";

/** OpenAI models list API URL (e.g. for testing API key). Env: OPENAI_MODELS_URL. Default "https://api.openai.com/v1/models". */
export const OPENAI_MODELS_URL =
  process.env.OPENAI_MODELS_URL?.trim() || "https://api.openai.com/v1/models";

export const OPENAI_TRANSCRIPTION_DEFAULT_URL =
  process.env.OPENAI_TRANSCRIPTION_DEFAULT_URL?.trim() ||
  "https://api.openai.com/v1/audio/transcriptions";

/** SendGrid scopes API URL (e.g. for testing API key). Env: SENDGRID_SCOPES_URL. Default "https://api.sendgrid.com/v3/scopes". */
export const SENDGRID_SCOPES_URL =
  process.env.SENDGRID_SCOPES_URL?.trim() ||
  "https://api.sendgrid.com/v3/scopes";

/** SendGrid mail send API URL. Env: SENDGRID_MAIL_SEND_URL. Default "https://api.sendgrid.com/v3/mail/send". */
export const SENDGRID_MAIL_SEND_URL =
  process.env.SENDGRID_MAIL_SEND_URL?.trim() ||
  "https://api.sendgrid.com/v3/mail/send";

/** reCAPTCHA siteverify API URL. Env: RECAPTCHA_VERIFY_URL. Default "https://www.google.com/recaptcha/api/siteverify". */
export const RECAPTCHA_VERIFY_URL =
  process.env.RECAPTCHA_VERIFY_URL?.trim() ||
  "https://www.google.com/recaptcha/api/siteverify";

/** hCaptcha siteverify API URL. Env: HCAPTCHA_VERIFY_URL. Default "https://hcaptcha.com/siteverify". */
export const HCAPTCHA_VERIFY_URL =
  process.env.HCAPTCHA_VERIFY_URL?.trim() || "https://hcaptcha.com/siteverify";

/** FTP client timeout in milliseconds. Env: FTP_CLIENT_TIMEOUT_MS. Default 60000 (60s). */
export const FTP_CLIENT_TIMEOUT_MS =
  Number(process.env.FTP_CLIENT_TIMEOUT_MS) || 60_000;

/** User-Agent for podcast import (feed fetch and enclosure download). Uses APP_NAME. Env: IMPORT_USER_AGENT. Default "${APP_NAME}-Import/1.0". */
export const IMPORT_USER_AGENT =
  process.env.IMPORT_USER_AGENT?.trim() || `${APP_NAME}-Import/1.0`;

/** Timeout in ms for podcast import HTTP requests (feed and enclosure). Env: IMPORT_FETCH_TIMEOUT_MS. Default 60000 (60s). */
export const IMPORT_FETCH_TIMEOUT_MS =
  Number(process.env.IMPORT_FETCH_TIMEOUT_MS) || 60_000;

/** Allow import to fetch from private/internal URLs (localhost, 10.x, 192.168.x, etc). Env: IMPORT_ALLOW_PRIVATE_URLS. Default false. Set to "true" or "1" for dev/testing. */
export const IMPORT_ALLOW_PRIVATE_URLS =
  process.env.IMPORT_ALLOW_PRIVATE_URLS === "true" ||
  process.env.IMPORT_ALLOW_PRIVATE_URLS === "1";

/** Minimum role to edit segments. Env: ROLE_MIN_EDIT_SEGMENTS. Default "editor". */
export const ROLE_MIN_EDIT_SEGMENTS = parseShareRole(
  process.env.ROLE_MIN_EDIT_SEGMENTS,
  "editor",
);

/** Minimum role to edit episode/podcast metadata. Env: ROLE_MIN_EDIT_METADATA. Default "manager". */
export const ROLE_MIN_EDIT_METADATA = parseShareRole(
  process.env.ROLE_MIN_EDIT_METADATA,
  "manager",
);

/** Minimum role to manage collaborators. Env: ROLE_MIN_MANAGE_COLLABORATORS. Default "manager". */
export const ROLE_MIN_MANAGE_COLLABORATORS = parseShareRole(
  process.env.ROLE_MIN_MANAGE_COLLABORATORS,
  "manager",
);

/** AAD for DNS-related encrypted secrets (Cloudflare API token etc). Env: DNS_SECRETS_AAD. */
export const DNS_SECRETS_AAD =
  process.env.DNS_SECRETS_AAD?.trim() || `${APP_NAME}-dns`;
