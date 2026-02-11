import { join } from 'path';

/**
 * Central app config. All values can be overridden via environment variables.
 * Use .env or set in the shell when running the server.
 */

/** Application display name (emails, RSS, etc). Env: APP_NAME */
export const APP_NAME = process.env.APP_NAME?.trim() || 'HarborFM';

/** Server port. Env: PORT. Default 3001. */
export const PORT = Number(process.env.PORT) || 3001;

/** Min free storage (MB) required to record a new section. Env: RECORD_MIN_FREE_MB. Default 5. */
export const RECORD_MIN_FREE_MB = Number(process.env.RECORD_MIN_FREE_MB) || 5;
export const RECORD_MIN_FREE_BYTES = RECORD_MIN_FREE_MB * 1024 * 1024;

/** RSS/sitemap cache max age in ms. Env: RSS_CACHE_MAX_AGE_MS. Default 1 hour. */
export const RSS_CACHE_MAX_AGE_MS = Number(process.env.RSS_CACHE_MAX_AGE_MS) || 60 * 60 * 1000;

/** Max episode source audio upload size (MB). Env: EPISODE_AUDIO_UPLOAD_MAX_MB. Default 500. */
export const EPISODE_AUDIO_UPLOAD_MAX_MB = Number(process.env.EPISODE_AUDIO_UPLOAD_MAX_MB) || 500;
export const EPISODE_AUDIO_UPLOAD_MAX_BYTES = EPISODE_AUDIO_UPLOAD_MAX_MB * 1024 * 1024;

/** Max recorded segment upload size (MB). Env: SEGMENT_UPLOAD_MAX_MB. Default 100. */
export const SEGMENT_UPLOAD_MAX_MB = Number(process.env.SEGMENT_UPLOAD_MAX_MB) || 100;
export const SEGMENT_UPLOAD_MAX_BYTES = SEGMENT_UPLOAD_MAX_MB * 1024 * 1024;

/** Max library asset upload size (MB). Env: LIBRARY_UPLOAD_MAX_MB. Default 50. */
export const LIBRARY_UPLOAD_MAX_MB = Number(process.env.LIBRARY_UPLOAD_MAX_MB) || 50;
export const LIBRARY_UPLOAD_MAX_BYTES = LIBRARY_UPLOAD_MAX_MB * 1024 * 1024;

/** Max multipart body size (MB) for Fastify. Env: MULTIPART_MAX_MB. Default 500. */
export const MULTIPART_MAX_MB = Number(process.env.MULTIPART_MAX_MB) || 500;
export const MULTIPART_MAX_BYTES = MULTIPART_MAX_MB * 1024 * 1024;

/** Max podcast/episode artwork upload size (MB). Env: ARTWORK_MAX_MB. Default 5. */
export const ARTWORK_MAX_MB = Number(process.env.ARTWORK_MAX_MB) || 5;
export const ARTWORK_MAX_BYTES = ARTWORK_MAX_MB * 1024 * 1024;

/** Path to ffmpeg binary. Env: FFMPEG_PATH. Default "ffmpeg". */
export const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';

/** Path to ffprobe binary. Env: FFPROBE_PATH. Default "ffprobe". */
export const FFPROBE_PATH = process.env.FFPROBE_PATH ?? 'ffprobe';

/** Path to audiowaveform binary. Env: AUDIOWAVEFORM_PATH. Default "audiowaveform". */
export const AUDIOWAVEFORM_PATH = process.env.AUDIOWAVEFORM_PATH ?? 'audiowaveform';

/** Directory to serve static web app from. Env: PUBLIC_DIR. Default "public" under project. */
export const PUBLIC_DIR = process.env.PUBLIC_DIR ?? join(process.cwd(), 'public');

/** Max "invite to platform" emails per inviter per 24 hours. Env: PLATFORM_INVITES_PER_DAY. Default 10. */
export const MAX_PLATFORM_INVITES_PER_DAY = Number(process.env.PLATFORM_INVITES_PER_DAY) || 10;

/** Prefix for API keys (used to distinguish from other tokens). Env: API_KEY_PREFIX. Default "hfm_". */
export const API_KEY_PREFIX = (process.env.API_KEY_PREFIX?.trim() || 'hfm_');

/** Max API keys per user. Env: MAX_API_KEYS_PER_USER. Default 5. */
export const MAX_API_KEYS_PER_USER = Number(process.env.MAX_API_KEYS_PER_USER) || 5;

/** Name of the CSRF cookie. Env: CSRF_COOKIE_NAME. Default "harborfm_csrf". */
export const CSRF_COOKIE_NAME = (process.env.CSRF_COOKIE_NAME?.trim() || 'harborfm_csrf');
