import { join, resolve } from "path";
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

/** Node environment. Env: NODE_ENV. Default "development". */
export const NODE_ENV = process.env.NODE_ENV ?? "development";

/** Whether app is running in production. */
export const IS_PRODUCTION = NODE_ENV === "production";

/** API path segment (no slashes). Routes live under /${API_PREFIX}/. Env: API_PREFIX. Default "api". */
export const API_PREFIX = process.env.API_PREFIX?.trim() || "api";

/** CORS origin: true = allow request origin (e.g. dev), false = no CORS. Env: CORS_ORIGIN. Default: false in production, true otherwise. */
export const CORS_ORIGIN =
  process.env.CORS_ORIGIN !== undefined
    ? process.env.CORS_ORIGIN === "true" || process.env.CORS_ORIGIN === "1"
    : !IS_PRODUCTION;

/** 2FA challenge cookie name (HttpOnly, for setup/verify flows). Env: TWOFA_CHALLENGE_COOKIE_NAME. */
export const TWOFA_CHALLENGE_COOKIE_NAME =
  process.env.TWOFA_CHALLENGE_COOKIE_NAME?.trim() ||
  `${APP_NAME_SLUG}_twofa_challenge`;

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

/** When true, episode video generation (node-canvas + ffmpeg) is enabled. Requires canvas native deps. Env: ALLOW_VIDEO_GENERATION. Default false. */
export const ALLOW_VIDEO_GENERATION =
  process.env.ALLOW_VIDEO_GENERATION?.trim() === "1" ||
  process.env.ALLOW_VIDEO_GENERATION?.trim() === "true";

/** When false, WebRTC/group calls are disabled (e.g. Terraform webrtc_enabled=0). Env: WEBRTC_ENABLED. Default false when unset or invalid. */
export const WEBRTC_ENABLED =
  process.env.WEBRTC_ENABLED?.trim() === "1" ||
  process.env.WEBRTC_ENABLED?.trim() === "true";

/** WebRTC service base URL (e.g. http://webrtc:3002). When set, group call creates a mediasoup room. Env: WEBRTC_SERVICE_URL. */
export const WEBRTC_SERVICE_URL = process.env.WEBRTC_SERVICE_URL?.trim() || null;

/** Public WebSocket URL for the WebRTC service (e.g. wss://example.com/webrtc-ws or ws://localhost:3002 for dev). Returned to the client so the browser can connect. Env: WEBRTC_PUBLIC_WS_URL. */
export const WEBRTC_PUBLIC_WS_URL = process.env.WEBRTC_PUBLIC_WS_URL?.trim() || null;

/** Secret for webrtc service to call back when a recording is ready (create segment from path). Env: RECORDING_CALLBACK_SECRET. */
export const RECORDING_CALLBACK_SECRET =
  process.env.RECORDING_CALLBACK_SECRET?.trim() || null;

/** Secret for authenticating HTTP requests between main app and WebRTC service. Env: WEBRTC_SERVICE_SECRET. */
export const WEBRTC_SERVICE_SECRET =
  process.env.WEBRTC_SERVICE_SECRET?.trim() || null;

/** Host-away grace period (ms) when no guests. Env: HOST_AWAY_GRACE_NO_GUESTS_MS. Default 60000 (1 min). */
export const HOST_AWAY_GRACE_NO_GUESTS_MS =
  Number(process.env.HOST_AWAY_GRACE_NO_GUESTS_MS) || 60_000;

/** Host-away grace period (ms) when recording in progress, no guests. Env: HOST_AWAY_GRACE_NO_GUESTS_RECORDING_MS. Default 120000 (2 min). */
export const HOST_AWAY_GRACE_NO_GUESTS_RECORDING_MS =
  Number(process.env.HOST_AWAY_GRACE_NO_GUESTS_RECORDING_MS) || 120_000;

/** Host-away grace period (ms) when guests are present. Env: HOST_AWAY_GRACE_WITH_GUESTS_MS. Default 300000 (5 min). */
export const HOST_AWAY_GRACE_WITH_GUESTS_MS =
  Number(process.env.HOST_AWAY_GRACE_WITH_GUESTS_MS) || 300_000;

/** Host-away checker interval (ms). Env: HOST_AWAY_CHECK_INTERVAL_MS. Default 30000. */
export const HOST_AWAY_CHECK_INTERVAL_MS =
  Number(process.env.HOST_AWAY_CHECK_INTERVAL_MS) || 30_000;

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

/** Data directory (uploads, recordings, DB, etc). Env: DATA_DIR. Default "data" under project. */
export const DATA_DIR = resolve(
  process.env.DATA_DIR ?? join(process.cwd(), "data"),
);

/** Secrets directory (JWT secret, setup token, etc). Env: SECRETS_DIR. Default "secrets" under project. */
export const SECRETS_DIR = resolve(
  process.env.SECRETS_DIR ?? join(process.cwd(), "secrets"),
);

/** WebRTC recordings directory override. When set, webrtc service writes here. Env: WEBRTC_RECORDINGS_DIR. */
export const WEBRTC_RECORDINGS_DIR =
  process.env.WEBRTC_RECORDINGS_DIR?.trim() || null;

/** SQLite database filename (under DATA_DIR). Env: DB_FILENAME. Default derived from APP_NAME (e.g. harborfm.db). */
export const DB_FILENAME =
  process.env.DB_FILENAME?.trim() || `${APP_NAME_SLUG}.db`;

/** Database provider: sqlite (default) or mysql. Env: DB_PROVIDER */
export const DB_PROVIDER =
  (process.env.DB_PROVIDER?.trim()?.toLowerCase() as "sqlite" | "mysql") ||
  "sqlite";

/** MySQL connection URL. Required when DB_PROVIDER=mysql. Env: DATABASE_URL */
export const DATABASE_URL = process.env.DATABASE_URL?.trim() || null;

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

/** JWT signing secret from env. When unset, app falls back to file or generates one. Env: JWT_SECRET. */
export const JWT_SECRET = process.env.JWT_SECRET?.trim() || null;

/** Explicit cookie Secure flag. When set, overrides default (Secure in production). Env: COOKIE_SECURE. */
export const COOKIE_SECURE = process.env.COOKIE_SECURE?.trim() || undefined;

/** Whether the JWT cookie is signed (requires @fastify/cookie secret). Env: JWT_COOKIE_SIGNED. Default false. */
export const JWT_COOKIE_SIGNED =
  process.env.JWT_COOKIE_SIGNED === "true" ||
  process.env.JWT_COOKIE_SIGNED === "1";

/** Render rate limit: min ms between "Make Final Episode" requests per user. 0 = no limit (e.g. for e2e). Env: RENDER_RATE_LIMIT_WINDOW_MS. Default 60000 (1 min). */
export const RENDER_RATE_LIMIT_WINDOW_MS =
  process.env.RENDER_RATE_LIMIT_WINDOW_MS !== undefined
    ? Number(process.env.RENDER_RATE_LIMIT_WINDOW_MS)
    : 60_000;

/** Forgot-password request cooldown (minutes). Env: FORGOT_PASSWORD_RATE_MINUTES. Default 5. */
export const FORGOT_PASSWORD_RATE_MINUTES =
  Number(process.env.FORGOT_PASSWORD_RATE_MINUTES) || 5;

/** Forgot-password IP rate limit: max requests per time window per IP. Env: FORGOT_PASSWORD_IP_RATE_LIMIT_MAX. Default 5. */
export const FORGOT_PASSWORD_IP_RATE_LIMIT_MAX =
  Number(process.env.FORGOT_PASSWORD_IP_RATE_LIMIT_MAX) || 5;

/** Profile update (email/username) rate limit (minutes). Env: PROFILE_UPDATE_RATE_LIMIT_MINUTES. Default 5. Max 60. */
export const PROFILE_UPDATE_RATE_LIMIT_MINUTES =
  Number(process.env.PROFILE_UPDATE_RATE_LIMIT_MINUTES) || 5;

export const PROFILE_UPDATE_RATE_LIMIT_MS =
  PROFILE_UPDATE_RATE_LIMIT_MINUTES * 60 * 1000;

/** Profile update request rate limit: window (ms). Env: PROFILE_UPDATE_REQUEST_RATE_LIMIT_MS. Default 60000 (1 min). */
export const PROFILE_UPDATE_REQUEST_RATE_LIMIT_MS =
  Number(process.env.PROFILE_UPDATE_REQUEST_RATE_LIMIT_MS) || 60_000;
/** Profile update request rate limit: max requests per window. Env: PROFILE_UPDATE_REQUEST_RATE_LIMIT_MAX. Default 5. */
export const PROFILE_UPDATE_REQUEST_RATE_LIMIT_MAX =
  Number(process.env.PROFILE_UPDATE_REQUEST_RATE_LIMIT_MAX) || 5;

/** 2FA challenge token expiry (minutes). Env: AUTH_2FA_CHALLENGE_EXPIRY_MINUTES. Default 10. */
export const AUTH_2FA_CHALLENGE_EXPIRY_MINUTES =
  Number(process.env.AUTH_2FA_CHALLENGE_EXPIRY_MINUTES) || 10;
export const AUTH_2FA_CHALLENGE_EXPIRY_MS =
  AUTH_2FA_CHALLENGE_EXPIRY_MINUTES * 60 * 1000;

/** 2FA challenge token size (bytes). Env: AUTH_CHALLENGE_TOKEN_BYTES. Default 24. */
export const AUTH_CHALLENGE_TOKEN_BYTES =
  Number(process.env.AUTH_CHALLENGE_TOKEN_BYTES) || 24;

/** JWT session expiry (days). Env: JWT_SESSION_EXPIRY_DAYS. Default 7. */
export const JWT_SESSION_EXPIRY_DAYS =
  Number(process.env.JWT_SESSION_EXPIRY_DAYS) || 7;
export const JWT_SESSION_EXPIRY = `${JWT_SESSION_EXPIRY_DAYS}d`;
export const SESSION_COOKIE_MAX_AGE_SECONDS =
  JWT_SESSION_EXPIRY_DAYS * 24 * 60 * 60;

/** Email verification token size (bytes). Env: VERIFICATION_TOKEN_BYTES. Default 24. */
export const VERIFICATION_TOKEN_BYTES =
  Number(process.env.VERIFICATION_TOKEN_BYTES) || 24;

/** Email verification link validity (hours). Env: VERIFICATION_EXPIRY_HOURS. Default 24. */
export const VERIFICATION_EXPIRY_HOURS =
  Number(process.env.VERIFICATION_EXPIRY_HOURS) || 24;

/** Password reset token size (bytes). Env: RESET_TOKEN_BYTES. Default 32. */
export const RESET_TOKEN_BYTES =
  Number(process.env.RESET_TOKEN_BYTES) || 32;

/** Login failure threshold: ban after this many failures in the window. Env: LOGIN_FAILURE_THRESHOLD. Default 3. */
export const LOGIN_FAILURE_THRESHOLD =
  Number(process.env.LOGIN_FAILURE_THRESHOLD) || 3;

/** Call-join failure threshold: ban after this many failures. Higher than login because invalid links can trigger multiple requests per page load (e.g. getJoinInfo + WebSocket guest). Env: CALL_JOIN_FAILURE_THRESHOLD. Default 6 (allows ~3 real attempts). */
export const CALL_JOIN_FAILURE_THRESHOLD =
  Number(process.env.CALL_JOIN_FAILURE_THRESHOLD) || 6;

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

/** Registration rate limit: max per time window per IP. Env: REGISTRATION_RATE_LIMIT_MAX. Default 5 (burst for CAPTCHA retries). Set higher (e.g. 100) for e2e. */
export const REGISTRATION_RATE_LIMIT_MAX =
  process.env.REGISTRATION_RATE_LIMIT_MAX !== undefined
    ? Number(process.env.REGISTRATION_RATE_LIMIT_MAX)
    : 5;

/** Review submit rate limit: max POST /public/reviews per time window per IP. Env: REVIEW_SUBMIT_RATE_LIMIT_MAX. Default 1. Set higher (e.g. 100) for e2e. */
export const REVIEW_SUBMIT_RATE_LIMIT_MAX =
  process.env.REVIEW_SUBMIT_RATE_LIMIT_MAX !== undefined
    ? Number(process.env.REVIEW_SUBMIT_RATE_LIMIT_MAX)
    : 1;

/** Review submit rate limit: time window. Env: REVIEW_SUBMIT_RATE_LIMIT_TIME_WINDOW. Default "1 minute". */
export const REVIEW_SUBMIT_RATE_LIMIT_TIME_WINDOW =
  process.env.REVIEW_SUBMIT_RATE_LIMIT_TIME_WINDOW?.trim() || "1 minute";

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
  !IS_PRODUCTION || process.env.SWAGGER_ENABLED === "true";

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

/** AAD for SSO-related encrypted secrets (OIDC client secrets, SAML certs). Env: SSO_SECRETS_AAD. */
export const SSO_SECRETS_AAD =
  process.env.SSO_SECRETS_AAD?.trim() || `${APP_NAME}-sso`;

/** When true, email/password sign-in is disabled (SSO only). Terraform can set SSO_EMAIL_SIGNIN_DISABLED=1. Env: SSO_EMAIL_SIGNIN_DISABLED. Default false. Applied at read time (does not write to DB). */
export const SSO_EMAIL_SIGNIN_DISABLED =
  process.env.SSO_EMAIL_SIGNIN_DISABLED?.trim() === "1" ||
  process.env.SSO_EMAIL_SIGNIN_DISABLED?.trim() === "true";

/** Path to JSON file with initial SSO providers: { "oidc": [...], "saml": [...] }. Terraform can write this (e.g. from templatefile). Env: SSO_PROVIDERS_INIT_JSON_PATH. */
export const SSO_PROVIDERS_INIT_JSON_PATH =
  process.env.SSO_PROVIDERS_INIT_JSON_PATH?.trim() || null;

/** Initial OIDC providers as JSON string. Merged by provider id; existing IDs are not overwritten. Env: SSO_OIDC_PROVIDERS_INIT. */
export const SSO_OIDC_PROVIDERS_INIT =
  process.env.SSO_OIDC_PROVIDERS_INIT?.trim() || null;

/** Initial SAML providers as JSON string. Merged by provider id; existing IDs are not overwritten. Env: SSO_SAML_PROVIDERS_INIT. */
export const SSO_SAML_PROVIDERS_INIT =
  process.env.SSO_SAML_PROVIDERS_INIT?.trim() || null;

/** Initial setup token for /setup?id=... URL. Env: SETUP_ID or SETUP_TOKEN. When set, used instead of file. */
export const SETUP_ID =
  process.env.SETUP_ID?.trim() || process.env.SETUP_TOKEN?.trim() || null;

/** Bootstrap admin email. With ADMIN_PASSWORD_HASH, creates admin on first boot. Env: ADMIN_EMAIL. */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim() || null;

/** Bootstrap admin password (argon2 hash). Requires ADMIN_EMAIL. Env: ADMIN_PASSWORD_HASH. */
export const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH?.trim() || null;

/** Path to file containing admin password hash (preferred over ADMIN_PASSWORD_HASH). Env: ADMIN_PASSWORD_HASH_FILE. */
export const ADMIN_PASSWORD_HASH_FILE =
  process.env.ADMIN_PASSWORD_HASH_FILE?.trim() || null;

/** Base64-encoded argon2 hash for seed-setup (from Terraform). Env: ADMIN_PASSWORD_HASH_B64. */
export const ADMIN_PASSWORD_HASH_B64 =
  process.env.ADMIN_PASSWORD_HASH_B64?.trim() || null;

/** Plaintext admin password (dev/seed only). Env: ADMIN_PASSWORD. */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || null;

/** Bootstrap admin hostname. When unset, falls back to https://DOMAIN when DOMAIN is valid. Env: ADMIN_HOSTNAME. */
export const ADMIN_HOSTNAME = process.env.ADMIN_HOSTNAME?.trim() || null;

/** Primary domain (for DNS, hostname fallback). Env: DOMAIN. */
export const DOMAIN = process.env.DOMAIN?.trim() ?? "";

/** Bootstrap: enable registration. Env: ADMIN_REGISTRATION_ENABLED. Set "1" for true. */
export const ADMIN_REGISTRATION_ENABLED =
  process.env.ADMIN_REGISTRATION_ENABLED === "1";

/** Bootstrap: enable public feeds. Env: ADMIN_PUBLIC_FEEDS_ENABLED. Set "1" for true. */
export const ADMIN_PUBLIC_FEEDS_ENABLED =
  process.env.ADMIN_PUBLIC_FEEDS_ENABLED === "1";

/** Master key for secrets encryption (base64). Env: HARBORFM_SECRETS_KEY. */
export const HARBORFM_SECRETS_KEY =
  process.env.HARBORFM_SECRETS_KEY?.trim() || null;

/** Email provider for seed-setup (smtp, sendgrid, webhook). Env: EMAIL_PROVIDER. */
export const EMAIL_PROVIDER =
  process.env.EMAIL_PROVIDER?.trim()?.toLowerCase() || null;

/** Webhook URL for email webhook provider. Env: EMAIL_WEBHOOK_URL. */
export const EMAIL_WEBHOOK_URL =
  process.env.EMAIL_WEBHOOK_URL?.trim() || null;

/** Field key for email webhook payload. Env: EMAIL_WEBHOOK_FIELD_KEY. Default "content". */
export const EMAIL_WEBHOOK_FIELD_KEY =
  process.env.EMAIL_WEBHOOK_FIELD_KEY?.trim() || "content";

/** Secret for Caddy on-demand TLS permission check. Env: CADDY_TLS_CHECK_SECRET. */
export const CADDY_TLS_CHECK_SECRET =
  process.env.CADDY_TLS_CHECK_SECRET?.trim() ?? "";

/** Computed admin hostname from env: ADMIN_HOSTNAME or https://DOMAIN when DOMAIN is valid (not localhost or wildcard). */
export function getAdminHostnameFromEnv(): string {
  if (ADMIN_HOSTNAME) return ADMIN_HOSTNAME;
  if (
    DOMAIN &&
    DOMAIN !== "localhost" &&
    DOMAIN !== "_"
  ) {
    return `https://${DOMAIN}`;
  }
  return "";
}
