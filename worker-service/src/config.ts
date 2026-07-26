import "dotenv/config";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

/** HarborFM origin or full API base, e.g. https://podcast.example.com or https://host/api */
export const HARBORFM_URL = required("HARBORFM_URL").replace(/\/+$/, "");
export const WORKER_WS_PATH = required("WORKER_WS_PATH");
export const WORKER_SECRET = required("WORKER_SECRET");
export const WORKER_NAME = process.env.WORKER_NAME?.trim() || "worker";
export const WHISPER_ASR_URL =
  process.env.WHISPER_ASR_URL?.trim() || "http://whisper:9000";
export const WORK_DIR =
  process.env.WORKER_WORK_DIR?.trim() || "/tmp/harborfm-worker";
export const FFMPEG_PATH = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
export const FFPROBE_PATH = process.env.FFPROBE_PATH?.trim() || "ffprobe";
export const AUDIOWAVEFORM_PATH =
  process.env.AUDIOWAVEFORM_PATH?.trim() || "audiowaveform";

function envPositiveInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/**
 * Upload chunk size in MiB (must stay under HarborFM / proxy body limits).
 * Env: WORKER_UPLOAD_CHUNK_MB. Default 50.
 */
export const WORKER_UPLOAD_CHUNK_MB = envPositiveInt(
  "WORKER_UPLOAD_CHUNK_MB",
  50,
);
export const WORKER_UPLOAD_CHUNK_BYTES =
  WORKER_UPLOAD_CHUNK_MB * 1024 * 1024;

/**
 * WebSocket keepalive interval (ms). Sends ping while connected so reverse
 * proxies do not idle-close during long encodes. Default 25000.
 * Env: WORKER_WS_HEARTBEAT_MS.
 */
export const WORKER_WS_HEARTBEAT_MS = envPositiveInt(
  "WORKER_WS_HEARTBEAT_MS",
  25_000,
);

/**
 * Resolve the worker WebSocket URL.
 * WORKER_WS_PATH may be the path token, a `/api/workers/ws/...` path, or a full
 * ws/wss/http/https connection URL (as shown in Settings > Workers).
 */
export function workerWsUrl(): string {
  const raw = WORKER_WS_PATH.trim();
  if (/^wss?:\/\//i.test(raw)) {
    return raw;
  }
  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  }

  let token = raw.replace(/^\/+/, "");
  const marker = "workers/ws/";
  const idx = token.toLowerCase().lastIndexOf(marker);
  if (idx >= 0) {
    token = token.slice(idx + marker.length).replace(/^\/+|\/+$/g, "");
  }

  const base = HARBORFM_URL;
  let origin = base;
  let apiPrefix = "/api";
  if (/\/api\/?$/i.test(base)) {
    origin = base.replace(/\/api\/?$/i, "");
    apiPrefix = "/api";
  }
  const u = new URL(origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = `${apiPrefix}/workers/ws/${token}`.replace(/\/{2,}/g, "/");
  u.search = "";
  u.hash = "";
  return u.toString();
}

export function apiBaseFromEnv(): string {
  if (/\/api\/?$/i.test(HARBORFM_URL)) {
    return HARBORFM_URL.replace(/\/+$/, "");
  }
  return `${HARBORFM_URL}/api`;
}
